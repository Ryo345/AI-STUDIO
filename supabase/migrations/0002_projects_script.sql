-- 0002_projects_script.sql — projects, script versions, scenes.
-- niche_key is TEXT on purpose: niches are a data-driven registry
-- (@studio/niches); adding a niche must not require a DB migration.
-- Domain-level enums DO get DB enums (status, aspect, format) because
-- their value sets change only with code that also changes writers.

create type public.project_status as enum ('draft', 'generating', 'ready', 'editing', 'archived');
create type public.aspect_ratio   as enum ('9:16', '16:9');
create type public.script_format as enum ('narrative', 'listicle', 'explainer');

-- ── script_versions (created before projects: circular FK added later) ──

create table public.script_versions (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null,
  version_number     integer not null check (version_number > 0),
  generated_script   jsonb not null,
  provenance         jsonb not null,
  created_at         timestamptz not null default now(),
  unique (project_id, version_number)
);

-- ── projects ────────────────────────────────────────────────────────────

create table public.projects (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references public.workspaces (id) on delete cascade,
  created_by                uuid references auth.users (id) on delete set null,
  title                     text not null check (length(trim(title)) between 1 and 120),
  niche_key                 text not null check (length(niche_key) between 1 and 32),
  topic                     text not null check (length(trim(topic)) between 3 and 300),
  -- config = ProjectConfig (zod, @studio/domain): aspectRatio enum, target
  -- duration, format, optional style/caption/music ids + instructions.
  config                    jsonb not null,
  status                    public.project_status not null default 'draft',
  current_script_version_id uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index projects_ws_created_idx on public.projects (workspace_id, created_at desc);

alter table public.script_versions
  add constraint script_versions_project_fk
  foreign key (project_id) references public.projects (id) on delete cascade;

-- circular reference: projects → its current version. SET NULL so deleting a
-- version (only possible via cascade today) never deletes the project.
alter table public.projects
  add constraint projects_current_script_fk
  foreign key (current_script_version_id) references public.script_versions (id) on delete set null;

-- ── scenes ──────────────────────────────────────────────────────────────

create table public.scenes (
  id                       uuid primary key default gen_random_uuid(),
  project_id               uuid not null references public.projects (id) on delete cascade,
  position                 integer not null check (position >= 0),
  origin_script_version_id uuid references public.script_versions (id) on delete set null,
  narration                text not null check (length(narration) between 1 and 4000),
  -- zod enforces 1..2000 at the API; the DB check is defense-in-depth
  -- (upper bound only: the completion RPC coalesces missing values to '').
  visual_description       text not null default '' check (length(visual_description) <= 2000),
  on_screen_text           text,
  duration_ms              integer not null check (duration_ms between 800 and 60000),
  sound_cues               jsonb not null default '[]'::jsonb,
  -- beatId / summary / onScreenTextStrategy survive regeneration here for
  -- Phase 2 (asset association + caption styling).
  meta                     jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (project_id, position)
);

create index scenes_project_idx on public.scenes (project_id, position);

-- ── Immutability of script versions ──────────────────────────────────────
-- The audit trail of what a provider ACTUALLY produced (provenance!) must
-- never be editable. BEFORE UPDATE ONLY:
--   * a BEFORE DELETE trigger would raise during the project/workspace
--     delete cascade and make deletion fail permanently (500 forever);
--   * RLS denies all user writes already (no insert/update/delete policies);
--   * service-role cascade deletes must pass through untouched.

create or replace function public.tg_script_versions_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'script_versions rows are immutable (attempted %)', TG_OP;
end;
$$;

revoke execute on function public.tg_script_versions_immutable() from public, anon, authenticated;

create trigger script_versions_no_update
  before update on public.script_versions
  for each row execute function public.tg_script_versions_immutable();

-- ── updated_at maintenance ──────────────────────────────────────────────

create trigger projects_touch
  before update on public.projects
  for each row execute function public.tg_touch_updated_at();

create trigger scenes_touch
  before update on public.scenes
  for each row execute function public.tg_touch_updated_at();

-- ── Reorder RPC ──────────────────────────────────────────────────────────
-- Membership cannot be validated by zod (it needs row checks), so the API
-- hands the raw id array here and this SECURITY DEFINER RPC is the single
-- validator + writer. Renumbering moves every row out of the way first,
-- because (project_id, position) is UNIQUE and in-place renumber would
-- collide.

create or replace function public.reorder_scenes(
  p_project_id uuid,
  p_scene_ids  uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws_id   uuid;
  v_count   integer;
  v_i       integer;
  v_len     integer;
begin
  select workspace_id into v_ws_id
  from public.projects
  where id = p_project_id
  for update;

  if v_ws_id is null then
    raise exception 'project not found: %', p_project_id using errcode = 'P0002';
  end if;

  if not public.has_workspace_role(v_ws_id, 'editor') then
    raise exception 'editor role required' using errcode = '42501';
  end if;

  v_len := array_length(p_scene_ids, 1);
  select count(*) into v_count from public.scenes where project_id = p_project_id;

  if v_len is null or v_len < 1 then
    raise exception 'sceneIds must contain at least one id' using errcode = '22023';
  end if;

  -- no duplicate ids
  if exists (
    select 1 from unnest(p_scene_ids) as u(id)
    group by id having count(*) > 1
  ) then
    raise exception 'sceneIds contains duplicates' using errcode = '22023';
  end if;

  -- same length as existing scenes
  if v_count <> v_len then
    raise exception 'sceneIds must list every scene exactly once (got % of %)', v_len, v_count
      using errcode = '22023';
  end if;

  -- every id belongs to this project (also rejects smuggled foreign ids)
  if exists (
    select 1
    from unnest(p_scene_ids) as u(id)
    where not exists (
      select 1 from public.scenes s where s.id = u.id and s.project_id = p_project_id
    )
  ) then
    raise exception 'sceneIds contains ids from another project' using errcode = '22023';
  end if;

  -- Move everything out of the unique range, then write final positions.
  update public.scenes
  set position = position + 1000000
  where project_id = p_project_id;

  for v_i in 1..v_len loop
    update public.scenes
    set position = v_i - 1
    where id = p_scene_ids[v_i] and project_id = p_project_id;
  end loop;
end;
$$;

revoke execute on function public.reorder_scenes(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_scenes(uuid, uuid[]) to authenticated, service_role;

-- ── RLS ─────────────────────────────────────────────────────────────────
-- DELETE policies exist so that ON DELETE cascades keep working when a
-- project (or a whole workspace) is deleted through a USER-session client.
-- Cascaded deletes/updates run with the deleting user's RLS rights, so
-- child tables need explicit delete policies or project deletion 500s.

alter table public.projects        enable row level security;
alter table public.script_versions enable row level security;
alter table public.scenes          enable row level security;

create policy "projects_member_read"
  on public.projects for select to authenticated
  using (public.has_workspace_role(projects.workspace_id, 'viewer'));

create policy "projects_editor_insert"
  on public.projects for insert to authenticated
  with check (
    public.has_workspace_role(projects.workspace_id, 'editor')
    and projects.created_by = auth.uid()
  );

create policy "projects_editor_update"
  on public.projects for update to authenticated
  using (public.has_workspace_role(projects.workspace_id, 'editor'))
  with check (public.has_workspace_role(projects.workspace_id, 'editor'));

create policy "projects_owner_delete"
  on public.projects for delete to authenticated
  using (public.has_workspace_role(projects.workspace_id, 'owner'));

create policy "script_versions_member_read"
  on public.script_versions for select to authenticated
  using (
    public.has_workspace_role(
      (select p.workspace_id from public.projects p where p.id = script_versions.project_id),
      'viewer'
    )
  );

create policy "script_versions_owner_delete"
  on public.script_versions for delete to authenticated
  using (
    public.has_workspace_role(
      (select p.workspace_id from public.projects p where p.id = script_versions.project_id),
      'owner'
    )
  );

create policy "scenes_member_read"
  on public.scenes for select to authenticated
  using (
    public.has_workspace_role(
      (select p.workspace_id from public.projects p where p.id = scenes.project_id),
      'viewer'
    )
  );

create policy "scenes_editor_update"
  on public.scenes for update to authenticated
  using (
    public.has_workspace_role(
      (select p.workspace_id from public.projects p where p.id = scenes.project_id),
      'editor'
    )
  )
  with check (
    public.has_workspace_role(
      (select p.workspace_id from public.projects p where p.id = scenes.project_id),
      'editor'
    )
  );

create policy "scenes_owner_delete"
  on public.scenes for delete to authenticated
  using (
    public.has_workspace_role(
      (select p.workspace_id from public.projects p where p.id = scenes.project_id),
      'owner'
    )
  );
