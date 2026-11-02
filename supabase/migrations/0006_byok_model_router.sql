-- 0006_byok_model_router.sql — BYOK credentials + per-task model router.
--
-- Two tables, one rule: the workspace owns its providers.
--
--   provider_connections — one row per (workspace, provider). Holds the API
--     key AES-256-GCM encrypted at rest (envelope built by
--     @studio/providers credential-crypto, key from CREDENTIAL_ENCRYPTION_KEY
--     env — never in the database, never in code). key_hint is the only
--     human-readable remnant ('nvapi-…abcd'); status/last_tested_at power
--     the connection badge and the test endpoint.
--
--   model_assignments — the model router: which provider+model serves each
--     AI task (script.generate today; the rest arrive with later phases).
--     task='default' row is the workspace-wide fallback; a task-specific row
--     overrides it. Resolution order: task row → default row → env
--     (SCRIPTWRITER_PROVIDER, dev-only convenience).
--
-- Security posture this file must never break:
--   * The `credential` column is readable by NO user principal — 0005's
--     default privileges grant table-level SELECT to authenticated, which
--     would expose ciphertext over PostgREST. Below we revoke table SELECT
--     and re-grant per column, so GET /rest/v1/provider_connections returns
--     masked metadata only, for every caller, forever. service_role keeps
--     the blanket grant (server-side key; the worker decrypts per job).
--   * No new RPCs — connections/assignments are plain RLS-gated table CRUD
--     from the web tier, and direct service-key reads from the worker.
--   * mock is never a connection or an assignment: mock output is honest
--     only when explicitly selected via env in dev; BYOK is for real keys.

begin;

-- ── types ───────────────────────────────────────────────────────────────
-- provider_id mirrors ScriptwriterProviderIdSchema (@studio/domain) plus
-- future providers as their adapters land (ALTER TYPE migration each time —
-- value sets change only with code that also changes writers).

create type public.provider_id as enum ('mock', 'anthropic', 'openai-compatible', 'nvidia-nim');

-- Every AI task the model router can route. Only script.generate is wired
-- to a job type today; the others exist so the settings UI can present the
-- full routing surface before later phases consume them.

create type public.ai_task as enum (
  'default',
  'script.generate',
  'script.rewrite',
  'research.assist',
  'fact.check',
  'scene.describe',
  'video.title',
  'video.description',
  'seo.metadata',
  'script.quality'
);

grant usage on type public.provider_id to authenticated, service_role;
grant usage on type public.ai_task     to authenticated, service_role;

-- ── provider_connections ────────────────────────────────────────────────

create table public.provider_connections (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  created_by      uuid references auth.users (id) on delete set null,
  provider_id     public.provider_id not null check (provider_id <> 'mock'),
  -- Custom endpoint override (null = provider hosted default). Required for
  -- openai-compatible connections (vLLM/OpenRouter/…); nvidia-nim and
  -- anthropic leave it null to use their built-in base URLs.
  base_url        text,
  -- AES-256-GCM envelope 'v1.<iv>.<tag>.<ct>' (base64url parts). Plaintext
  -- keys never touch the database, the frontend, or the logs.
  credential      text not null check (length(credential) <= 10000),
  -- Masked display form, e.g. 'nvapi-…9f2c'. Derived at write time so
  -- readers never need (and never get) the ciphertext.
  key_hint        text not null check (length(key_hint) between 4 and 40),
  -- 'untested' → 'active' | 'failed' via the connection-test endpoint.
  status          text not null default 'untested'
                    check (status in ('untested', 'active', 'failed')),
  last_tested_at  timestamptz,
  -- { code, message } from the last failed test — provider-specific error
  -- surface for the UI. Never contains the key.
  last_test_error jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, provider_id)
);

create trigger provider_connections_touch
  before update on public.provider_connections
  for each row execute function public.tg_touch_updated_at();

-- ── model_assignments ───────────────────────────────────────────────────

create table public.model_assignments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task         public.ai_task not null,
  provider_id  public.provider_id not null check (provider_id <> 'mock'),
  model        text not null check (length(model) between 1 and 200),
  -- Generation settings (temperature, top_p, max tokens, …) — validated by
  -- @studio/domain before write; free-form here on purpose so new provider
  -- parameters need no migration.
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, task)
);

create trigger model_assignments_touch
  before update on public.model_assignments
  for each row execute function public.tg_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────

alter table public.provider_connections enable row level security;
alter table public.model_assignments    enable row level security;

-- Connections: viewer read (masked metadata only — see column grants below),
-- editor manage, owner delete (keys outlive editors by design).

create policy "provider_connections_member_read"
  on public.provider_connections for select to authenticated
  using (public.has_workspace_role(provider_connections.workspace_id, 'viewer'));

create policy "provider_connections_editor_insert"
  on public.provider_connections for insert to authenticated
  with check (
    public.has_workspace_role(provider_connections.workspace_id, 'editor')
    and provider_connections.created_by = auth.uid()
  );

create policy "provider_connections_editor_update"
  on public.provider_connections for update to authenticated
  using (public.has_workspace_role(provider_connections.workspace_id, 'editor'))
  with check (public.has_workspace_role(provider_connections.workspace_id, 'editor'));

create policy "provider_connections_owner_delete"
  on public.provider_connections for delete to authenticated
  using (public.has_workspace_role(provider_connections.workspace_id, 'owner'));

-- Assignments: same shape as projects (read viewer, write editor, delete owner).

create policy "model_assignments_member_read"
  on public.model_assignments for select to authenticated
  using (public.has_workspace_role(model_assignments.workspace_id, 'viewer'));

create policy "model_assignments_editor_insert"
  on public.model_assignments for insert to authenticated
  with check (public.has_workspace_role(model_assignments.workspace_id, 'editor'));

create policy "model_assignments_editor_update"
  on public.model_assignments for update to authenticated
  using (public.has_workspace_role(model_assignments.workspace_id, 'editor'))
  with check (public.has_workspace_role(model_assignments.workspace_id, 'editor'));

create policy "model_assignments_owner_delete"
  on public.model_assignments for delete to authenticated
  using (public.has_workspace_role(model_assignments.workspace_id, 'owner'));

-- ── grants ──────────────────────────────────────────────────────────────
-- 0005's default privileges granted blanket DML to authenticated on every
-- future table, and table-level SELECT would include the `credential`
-- column. Fix the read side explicitly: revoke table SELECT, re-grant the
-- safe column list. (RLS gates rows; column privileges gate fields — both
-- are needed for keys.) DML grants mirror the policies above.

revoke select on public.provider_connections from authenticated;

grant select (
  id, workspace_id, created_by, provider_id, base_url, key_hint,
  status, last_tested_at, last_test_error, created_at, updated_at
) on public.provider_connections to authenticated;

grant insert, update          on public.provider_connections to authenticated;
grant select, update, delete  on public.model_assignments    to authenticated;
grant insert                  on public.model_assignments    to authenticated;

-- ── schema cache reload ─────────────────────────────────────────────────

notify pgrst_ddl_watch;

commit;
