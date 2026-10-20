-- 0001_init_core.sql — workspaces, memberships, profiles, signup bootstrap.
-- Phase 1 of the AI Video Automation Studio. Run exactly once, in order.
--
-- Conventions used across all migrations:
--   * RLS is the live enforcement layer for user-session clients (the Next.js
--     API uses the user's session, never the service key).
--   * SECURITY DEFINER helper functions always pin `set search_path` —
--     never rely on the caller's search path (Supabase CVE class).
--   * Mutation RPCs used by the worker revoke execution from public/anon/
--     authenticated and grant only to service_role. User-facing RPCs revoke
--     public/anon and check workspace membership internally.

-- ── Enum (declaration order = privilege order: viewer < editor < owner) ──
create type public.workspace_role as enum ('viewer', 'editor', 'owner');

-- ── Tables ──────────────────────────────────────────────────────────────

create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 80),
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  email         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          public.workspace_role not null default 'viewer',
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ── Privilege helper (RLS recursion break) ──────────────────────────────
-- Policies on workspace_members cannot reference workspace_members again
-- (infinite recursion), so membership checks go through this definer
-- function. Role comparisons rely on enum declaration order.

create or replace function public.has_workspace_role(
  p_workspace_id uuid,
  p_min_role     public.workspace_role
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = p_workspace_id
      and user_id = auth.uid()
      and workspace_members.role >= p_min_role
  );
$$;

-- RLS policies execute with the querying user's function privileges, so
-- authenticated must keep execute; anon/public must not.
revoke execute on function public.has_workspace_role(uuid, public.workspace_role) from public, anon;
grant execute on function public.has_workspace_role(uuid, public.workspace_role) to authenticated;

-- ── Signup bootstrap: profile + workspace + owner membership in one TX ──
-- A AFTER INSERT trigger on auth.users cannot partially fail without
-- breaking signup, so every coalesce here must tolerate a null email.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws_id       uuid;
  v_display     text;
  v_ws_name     text;
begin
  -- left() bounds hostile signup metadata: an oversized display_name would
  -- raise inside this trigger and fail the user's own signup (below,
  -- v_ws_name is bounded for exactly the same reason).
  v_display := left(
    coalesce(
      nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), ''),
      new.email,
      'new user'
    ),
    120
  );

  v_ws_name := left(
    coalesce(
      nullif(trim(coalesce(new.raw_user_meta_data ->> 'workspace_name', '')), ''),
      nullif(new.email, ''),
      'My workspace'
    ),
    80
  );

  insert into public.profiles (id, display_name, email)
  values (new.id, v_display, new.email);

  insert into public.workspaces (name)
  values (v_ws_name)
  returning id into v_ws_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws_id, new.id, 'owner');

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── RLS ─────────────────────────────────────────────────────────────────

alter table public.workspaces        enable row level security;
alter table public.profiles         enable row level security;
alter table public.workspace_members enable row level security;

create policy "workspaces_member_read"
  on public.workspaces for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = workspaces.id and m.user_id = auth.uid()
    )
  );

create policy "profiles_self_read"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "profiles_self_update"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Membership rows are visible to every member of that workspace; the owner
-- column leaks nothing a member should not see. Inserts are trigger-only
-- (definer bypasses RLS); users cannot self-grant membership.
create policy "members_member_read"
  on public.workspace_members for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_workspace_role(workspace_members.workspace_id, 'viewer')
  );

-- ── updated_at maintenance ─────────────────────────────────────────────

create or replace function public.tg_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.tg_touch_updated_at() from public, anon, authenticated;

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.tg_touch_updated_at();
