-- 0004_usage_assets.sql — usage accounting (live now) + asset registry
-- (schema reserved for Phase 2: TTS audio, stock/AI imagery, music,
-- captions, renders, thumbnails).
--
-- Usage accounting keeps expensive operations visible. Every provider call
-- lands here with is_mock split out: mock output is visible in the dashboard
-- but honestly priced, never silently presented as a real request.

create type public.asset_kind as enum (
  'stock_video', 'stock_image', 'ai_image', 'tts_audio',
  'music_track', 'caption_srt', 'render_mp4', 'thumbnail'
);

-- ── usage_events ────────────────────────────────────────────────────────

create table public.usage_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  -- Accounting rows survive the project they describe (SET NULL) — billing
  -- history must not vanish when a project is deleted.
  project_id    uuid references public.projects (id) on delete set null,
  job_id        uuid references public.jobs (id) on delete set null,
  provider_id   text not null,
  operation     text not null check (operation in ('script.generate')),
  quantity      numeric not null default 1,
  unit          text not null default 'request',
  is_mock       boolean not null default true,
  recorded_at   timestamptz not null default now()
);

create index usage_ws_recorded_idx on public.usage_events (workspace_id, recorded_at desc);
create index usage_project_idx     on public.usage_events (project_id);

-- ── assets ──────────────────────────────────────────────────────────────
-- Provenance + licensing is a hard project rule: every stored binary is
-- traceable to where it came from. Rows are written by worker RPCs in
-- Phase 2; storage keys point at a private Supabase Storage bucket
-- (signed URLs only, never public).

create table public.assets (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  project_id        uuid not null references public.projects (id) on delete cascade,
  -- scene_id nullable: renders, thumbnails, and music are project-scoped.
  -- SET NULL (not cascade) so deleting a scene leaves the binary row for
  -- license auditing; the storage object is orphan-swept in Phase 2.
  scene_id          uuid references public.scenes (id) on delete set null,
  kind              public.asset_kind not null,
  -- 'stock' | 'ai_generated' | 'tts' | 'music_stock' | 'render' | 'upload'
  source_type       text not null,
  -- Provider-side reference (stock clip id, TTS synthesis id, …).
  source_ref        text,
  storage_provider  text,
  storage_bucket    text,
  storage_key       text,
  bytes             bigint,
  mime_type         text,
  -- { license, attribution, searchQuery, promptHash, … }
  provenance        jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index assets_project_idx on public.assets (project_id);
create index assets_scene_idx   on public.assets (scene_id);

-- ── RLS ─────────────────────────────────────────────────────────────────
-- The UPDATE/DELETE policies below exist ONLY so cascades keep working
-- when a project is deleted through a user-session client (cascaded writes
-- execute with the deleting user's RLS rights):
--   * usage_events.project_id is SET NULL on project delete → UPDATE
--   * assets.project_id is CASCADE on project delete → DELETE
-- Tamper posture, accepted deliberately: a trusted workspace member with
-- the editor role can already read every usage row; usage accounting guards
-- against surprise cost, not against a hostile co-editor.

alter table public.usage_events enable row level security;
alter table public.assets        enable row level security;

create policy "usage_member_read"
  on public.usage_events for select to authenticated
  using (public.has_workspace_role(usage_events.workspace_id, 'viewer'));

create policy "usage_editor_cascade_update"
  on public.usage_events for update to authenticated
  using (public.has_workspace_role(usage_events.workspace_id, 'editor'))
  with check (public.has_workspace_role(usage_events.workspace_id, 'editor'));

create policy "assets_member_read"
  on public.assets for select to authenticated
  using (
    public.has_workspace_role(
      (select p.workspace_id from public.projects p where p.id = assets.project_id),
      'viewer'
    )
  );

-- Needed by the scene_set-null update when scenes are rewritten, and by the
-- project cascade delete.
create policy "assets_editor_cascade_update"
  on public.assets for update to authenticated
  using (
    public.has_workspace_role(
      (select p.workspace_id from public.projects p where p.id = assets.project_id),
      'editor'
    )
  )
  with check (
    public.has_workspace_role(
      (select p.workspace_id from public.projects p where p.id = assets.project_id),
      'editor'
    )
  );

create policy "assets_owner_cascade_delete"
  on public.assets for delete to authenticated
  using (
    public.has_workspace_role(
      (select p.workspace_id from public.projects p where p.id = assets.project_id),
      'owner'
    )
  );
