-- 0005_grant_matrix.sql — table privileges for the three Supabase roles.
--
-- This 2026-created project shipped with NO default table grants: every
-- direct .from(table) query through PostgREST (any key) fails with 42501.
-- 0001–0004 work only because SECURITY DEFINER RPCs execute as the function
-- owner (postgres), who holds all privileges implicitly. The web tier talks
-- to tables directly, so it has been blocked until this migration.
--
-- Two rules this file must never break:
--
--   1. NEVER grant function EXECUTE here (beyond the public/anon revoke
--      below). 0001–0004 carve EXECUTE per RPC: worker RPCs (claim_jobs,
--      complete_script_generation, …) are revoked from authenticated on
--      purpose — a blanket `grant execute on all functions to authenticated`
--      would let any signed-in user drain the queue and forge completions.
--
--   2. NEVER use `grant all` on tables for authenticated. ALL includes
--      TRUNCATE (and REFERENCES/TRIGGER), and RLS does not apply to
--      TRUNCATE — a signed-in user could wipe a table no policy lets them
--      delete a single row from. DML only, for every role.
--
-- RLS remains the live enforcement layer: where a table has no policy for a
-- command, RLS denies that command regardless of grants. The per-table grant
-- list below mirrors the policies so the grants document intent; a dead
-- grant is harmless, a missing one is an outage — when a future migration
-- adds a policy, pair it with its grant in the same file.

begin;

-- ── schema + types ─────────────────────────────────────────────────────
-- Schema USAGE is the front door: without it every query in the schema
-- fails at the privilege layer before RLS is even consulted. Enum USAGE is
-- DDL-context insurance (casts, signatures) — row reads need only the table
-- privilege — but it costs nothing and future-proofs Phase 2. Both are
-- normally provisioned by Supabase, but this project demonstrably stripped
-- default ACLs — restate idempotently rather than assume.

grant usage on schema public to anon, authenticated, service_role;

grant usage on type public.workspace_role   to authenticated, service_role;
grant usage on type public.project_status   to authenticated, service_role;
grant usage on type public.aspect_ratio     to authenticated, service_role;
grant usage on type public.script_format    to authenticated, service_role;
grant usage on type public.job_status       to authenticated, service_role;
grant usage on type public.job_type         to authenticated, service_role;
grant usage on type public.asset_kind       to authenticated, service_role;

-- ── authenticated — per-table DML, mirroring the RLS policies ──────────
-- Every policy in 0001–0004 targets `authenticated`; there is not a single
-- anon policy. Commands with no policy stay RLS-denied even where listed
-- below (e.g. jobs has no UPDATE policy — mutation only via RPCs).

-- Trigger-created only (handle_new_user); members read, never mutate.
grant select                                on public.workspaces        to authenticated;

-- Self read/update; rows are trigger-created. Account deletion has no live
-- path here: the auth.users FK cascade would run as supabase_auth_admin,
-- which holds no grants and no RLS policy on this table (deferred until
-- account deletion ships — via a SECURITY DEFINER RPC, not a grant).
grant select, update                        on public.profiles          to authenticated;

-- The privilege root: SELECT only. Membership is trigger-managed; the
-- no-mutation grant is half of the "users cannot self-grant roles" guard
-- (the RLS policy is the other half).
grant select                                on public.workspace_members to authenticated;

-- Full CRUD — the only user-facing DML table in the schema.
grant select, insert, update, delete        on public.projects          to authenticated;

-- Immutable script history: read + owner-cascade DELETE only. No
-- INSERT/UPDATE for anyone but the definer RPC that writes versions.
grant select, delete                        on public.script_versions   to authenticated;

-- Storyboard: read + editor edit + owner delete. Scenes are inserted only
-- by complete_script_generation; Phase 2 adds policy + grant together if
-- users ever insert directly.
grant select, update, delete                on public.scenes            to authenticated;

-- SELECT is load-bearing beyond listing: request_job_cancel / retry_job
-- return public.jobs rows, which PostgREST serializes under the caller's
-- SELECT privilege. INSERT backs the pristine-enqueue policy (WITH CHECK:
-- pending, attempt 0, unclaimed, created_by = auth.uid()). No UPDATE —
-- jobs move only through RPCs.
grant select, insert, delete                on public.jobs              to authenticated;

-- Stage timeline is read-only to users; rows are written by worker RPCs.
-- DELETE exists for the owner cascade path.
grant select, delete                        on public.job_events        to authenticated;

-- Usage rows survive project deletion via ON DELETE SET NULL — the UPDATE
-- grant (and policy) exists for that cascade, not for user edits.
grant select, update                        on public.usage_events      to authenticated;

-- Asset registry (Phase 2 writes via worker RPCs). UPDATE/DELETE back the
-- scene-rewrite and project-delete cascades.
grant select, update, delete                on public.assets            to authenticated;

-- ── service_role — blanket DML ─────────────────────────────────────────
-- Not needed for the RPC path (SECURITY DEFINER bodies run as owner), but
-- required for direct service-key access: integration-test seeding and
-- cleanup, ops scripts, and any Phase 2 worker code that reads tables
-- directly. DML only, same rule as above; the key is a server-side secret.

grant select, insert, update, delete on all tables in schema public to service_role;

-- ── anon — nothing, defensively ────────────────────────────────────────
-- No anon policies exist; RLS already returns zero rows. Revoke anyway in
-- case a stray ACL ever landed outside these migrations.

revoke all on all tables in schema public from anon;

-- ── function hardening (public + anon only) ────────────────────────────
-- Re-applies what 0001–0004 did per function and catches any function that
-- lacked an explicit revoke (Postgres auto-grants EXECUTE to PUBLIC on
-- CREATE FUNCTION). Touches only principals that hold no legitimate EXECUTE,
-- so every authenticated/service_role grant from 0001–0004 is preserved.

revoke execute on all functions in schema public from public, anon;

-- ── default privileges for FUTURE objects ──────────────────────────────
-- Migrations run as postgres via both `supabase db push` and the SQL editor,
-- so these cover objects created by 0006+. They never retrofit existing
-- objects — hence the explicit grants above. Fail-safe on purpose: a
-- forgotten grant is an outage (this migration exists because of one), a
-- default DML grant costs nothing while RLS gates every row.

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

-- Future sequences (none exist today — every PK is gen_random_uuid()): a
-- serial/identity column under a web-tier INSERT needs USAGE on its
-- sequence, and no table grant covers that.

alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

-- Future functions: strip the initial {=X/owner} ACL (EXECUTE to PUBLIC).
-- Revoking from anon alone matches nothing — anon holds EXECUTE only via
-- PUBLIC — so both principals must be named. Each user-facing RPC still
-- carries its explicit `grant execute … to authenticated|service_role`
-- (the 0001–0004 convention), which is what keeps the API tier working.

alter default privileges in schema public
  revoke execute on functions from public, anon;

-- PostgREST caches allowed operations per table from privileges; a GRANT may
-- not trip the DDL-watch event trigger, so force the schema-cache reload.

notify pgrst_ddl_watch;

commit;
