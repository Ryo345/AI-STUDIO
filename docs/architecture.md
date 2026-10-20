# Architecture

AI Video Automation Studio — turn a topic into a timed, scene-structured
script, then (Phase 2) voiceover, visuals, captions, and a rendered MP4 for
YouTube across niches. This document is the durable map: what lives where,
which invariant each piece enforces, and the decisions that are **settled**
(do not re-litigate without a very good reason).

## Shape of the system

```
Browser (apps/web, Next.js)
  │  user session (anon key + JWT; RLS is the enforcement layer)
  ▼
Supabase Postgres  ←── enqueued job rows (queue table)
  ▲
  │ service_role key — SECURITY DEFINER RPCs only
Worker process (M5, apps/worker)
  │  claims → heartbeats → provider call (scriptwriter adapter)
  │  → atomic completion RPC
  ▼
Provider adapters (@studio/ai, M6): mock | anthropic | openai-compatible
```

Hard rule that shapes everything: **web requests never call providers and
never render video.** They enqueue work, render progress, and read results.
All expensive operations happen in the worker, are visible as jobs, and are
accounted in `usage_events`.

## Monorepo layout

| Package | Role |
| --- | --- |
| `packages/domain` | Zod schemas + DTO contracts + API error taxonomy. No I/O. The shared language of every other package. |
| `packages/niches` | Data-driven niche template registry (horror, automotive, education, documentary, gaming + `custom`). Integrity-invariant-checked. |
| `packages/db` | Supabase env config (fail-fast), client factory, row↔DTO mappers, typed queries, wrappers over the SECURITY DEFINER RPCs. |
| `apps/web` | Next.js frontend + API routes (M3+). Browser sees only the anon key. |
| `apps/worker` (M5) | Queue poller + scriptwriter pipeline. Only process with provider keys + service role key. |
| `packages/ai` (M6) | Provider adapters, fixture-tested against real shapes. |
| `packages/queue-core` (M5) | Worker loop primitives; the pure `backoff()` mirror of the SQL formula. |

Milestones M0–M2 (scaffold, domain+templates, migrations+db) are **live and
tested**. M3–M6 add web, wizard, queue/worker/adapter production, and
hardening in that order.

## Database (supabase/migrations)

Four ordered files. **Plpgsql resolves `usage_events` (created in 0004) at
first call from 0003** — migrations only work in order.

- **0001 core:** `workspaces`, `profiles`, `workspace_members`
  (`workspace_role` enum: `viewer < editor < owner` — declaration order,
  so SQL `role >= p_min_role` does privilege math), `handle_new_user`
  trigger (every signup instantly gets an owned workspace — zero seeding).
- **0002 projects:** `projects` (status machine
  `draft → generating → ready → editing → archived`), **immutable**
  `script_versions` (BEFORE UPDATE trigger only — a BEFORE DELETE variant
  would break the delete cascade; the audit trail of what the provider
  *actually produced* is never editable), `scenes`, `reorder_scenes` RPC.
  `niche_key` is TEXT on purpose: niches are data, not schema.
- **0003 queue:** `jobs`, `job_events`, and the RPC surface below.
- **0004 usage/assets:** `usage_events` (is_mock split; rows survive project
  deletion — billing history is not collateral), `assets` registry
  (provenance + licensing per stored binary; Phase 2 fills it).

### Job queue semantics (the settled contract)

One partial unique index — `jobs(project_id) WHERE type='script.generate'
AND status IN ('pending','running')` — makes double-queueing structurally
impossible (second insert → 23505 → API 409), and gives `retry_job` its
double-click safety for free.

| RPC | Grant | Contract |
| --- | --- | --- |
| `claim_jobs(worker, limit)` | service_role only | Single atomic statement: `FOR UPDATE SKIP LOCKED`. Claims do **not** increment `attempt` — attempts count genuine provider failures only. Skips queued-cancelled jobs. |
| `heartbeat_job(job, worker)` | service_role only | Fuses liveness + cancel poll; server-side clock; returns `cancel_requested`. Zero rows = stolen lock. TS wrapper inverts it: `true`=keep, `false`=honor cancel, `null`=stop immediately. |
| `job_failed(job, worker, err)` | service_role only | `attempt+1`; retryable → pending with exponential backoff `30·2^attempt` capped 600s (**post-increment**: first retry = 60s; `@studio/queue-core`'s pure `backoff()` must mirror this); `err.retryable=false` → terminal immediately, no retry scheduled (attempt still records the failure). At max attempts → terminal `failed`, project reverts (`editing` if it ever had a script, else `draft`). |
| `reclaim_stale_jobs(stale_seconds)` | service_role only | Crash recovery: stale `running` → `pending`, **attempt preserved**, `reclaimed_count++`; ≥3 reclaims → terminal `failed/stale_lock`. Settles queued cancels first. |
| `complete_script_generation(…)` | service_role only | THE atomic fulfillment: inserts the script version, rewrites scenes, flips project → `ready`, job → `succeeded`, writes the usage event — one RPC because supabase-js has no transactions. Guarded on `status='running' AND locked_by=worker`; stolen lock ⇒ returns the unchanged row (work discarded, truth reported). Returns `null` if the job row vanished (project deleted mid-run). Locks the project row **before** scenes to match `reorder_scenes`'s lock order (no cross-RPC deadlock window). |
| `append_job_event(worker, job, kind, detail)` | service_role only | "Save progress after every stage": worker progress marks, same lock guard. |
| `request_job_cancel` / `retry_job` | authenticated (editor check inside) | Cancel: pending→cancelled now (+project revert); running→flag honored at next heartbeat; terminal→no-op truth. Retry: failed/cancelled only; resets attempt **and** reclaimed_count (fresh budget). |
| `reorder_scenes` | authenticated (editor check inside) | Row-locks the project, validates length/duplicates/membership (foreign-id smuggling rejected), moves rows out of the unique range then renumbers. |

Script regeneration **clobbers scene edits deliberately**: the completed
script is the source of truth, but every prior `script_versions` row is
immutable history. The UI warns before regenerating an edited project.

## Security model

### Key exposure matrix

| Secret | Web browser | Web server | Worker | Tests |
| --- | :-: | :-: | :-: | :-: |
| anon key (`NEXT_PUBLIC_`…) | ✅ by design (RLS enforced) | ✅ | ✅ | ✅ |
| service_role key | ❌ never | ❌ never | ✅ RPC-only | ✅ gated |
| provider API keys | ❌ | ❌ | ✅ | fixtures only |

**Never expose secret API keys in frontend code** is enforced structurally:
the web app imports no code path that reads them, the service-role RPCs are
revoked from `anon`/`authenticated`, and `loadDbConfig` fail-fasts on
placeholder values.

### RLS discipline

- The **user session** is the live enforcement layer on the web tier.
- The **worker** holds the service key but is only granted
  `SECURITY DEFINER` RPCs — every one pins `set search_path`, is revoked
  from `public`/`anon`/(and, for worker RPCs) `authenticated`.
- User-facing RPCs re-check `has_workspace_role(workspace, 'editor')`
  internally (zod cannot express membership; RLS cannot constrain RPCs).
- **Cascade-vs-RLS**: cascaded deletes/updates run with the *deleting user's*
  RLS rights, so child tables carry explicit delete/update policies
  (owner-delete for scenes/versions/jobs/events; editor-update where SET
  NULL fires). Without them, deleting a project 500s mid-cascade forever.
- `jobs` has **no UPDATE policy** on purpose: mutation flows only through
  the RPCs. `jobs` INSERT carries a cross-workspace smuggling guard
  (referenced project must belong to the row's workspace) and admits
  only pristine `pending` rows — server-owned state (locks, cancel
  marks, post-pending statuses) is not insertable, and `created_by` is
  pinned to the caller.
- **Tamper posture, accepted**: a trusted editor can read (not alter)
  accounting rows; usage guards against surprise cost, not hostile
  co-editors. Workspace membership itself is owner-managed through the UI.

## Honest-mock policy

The user ships **no AI credentials today**, so `mock` is the default
provider — and the whole system is built so that fact is always visible:

- Every produced script carries `provenance.isMock` and the UI shows a
  MOCK badge wherever one does;
- every `usage_events` row splits `realRequests` / `mockRequests`;
- a real provider selected without its key **fails worker boot** — never a
  silent fallback in either direction;
- `MOCK_GENERATE_DELAY_MS` simulates latency so cancel/reclaim/heartbeat
  paths can be exercised with zero credentials.

**Placeholder output is never presented as a real generated video** — the
same policy extends to Phase 2 renders.

## API surface (M4+ summary)

REST under `/api/v1`: `.json` envelopes, zod-validated inputs
(`strictObject`), a nine-code error taxonomy shared from `@studio/domain`
(`unique_active_job` → 409, `provider_error` → 502, …), range pagination
(`limit` 1–100), DTO-only responses (never DB rows). Contract table lives
in the approved plan and lands with the web milestones.

## Verification tiering

| Tier | Command | Gate |
| --- | --- | --- |
| Unit / domain / templates | `npm test` | always runs, zero credentials |
| Type safety | `npm run typecheck` | all workspaces, `tsc --noEmit` |
| Integration (real Supabase) | `npm run test:int` | `INT=1` + real env; creates + cleans throwaway rows |

The integration tier is the only place RLS, the queue RPCs, and the
membership checks are proven against a real Postgres — unit tests cannot
see RLS (the service key bypasses it, so they would lie).
