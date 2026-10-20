# Supabase Setup Guide

The app uses [Supabase](https://supabase.com) cloud for **Auth**, **Postgres**,
and (in Phase 2) **Storage**. Nothing runs locally — no Docker, no local
Postgres. Setup takes ~10 minutes, most of it waiting for Supabase to
provision the database.

---

## 1. Create the project

1. Go to <https://supabase.com> → **Sign in** (GitHub login works).
2. **New project** → pick any name (e.g. `ai-video-studio`), generate a
   strong database password (save it somewhere — unused by this app, but
   Supabase requires it), and choose the region closest to you.
3. Wait for provisioning (~2 min). Free tier is fine.

> **Recommendation:** start with a **disposable/test project** while
> developing. Migrations drop foreign keys and recreate types freely in
> early development; if you ever need a clean slate, you can run
> `supabase db reset` (CLI) or delete and recreate the project.

## 2. Copy the three values into `.env`

Supabase dashboard → your project → **Project Settings → API**.

Copy `.env.example` to `.env` (repo root) and fill in:

| .env variable            | Where in the Supabase dashboard             |
| ------------------------ | -------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`   | Project URL (`https://xxxx.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Project API keys** → `anon` / `public` |
| `SUPABASE_SERVICE_ROLE_KEY`    | **Project API keys** → `service_role`     |

Safety contract (enforced by code review, not vibes):

- The **anon key** is safe for the browser — every query it makes passes
  through **Row Level Security** policies. This is the intended design.
- The **service_role** key bypasses RLS entirely. It is read **only** by the
  worker process and the integration tests — `@studio/db` fails fast at boot
  if it is missing or still a placeholder. It must **never** carry a
  `NEXT_PUBLIC_` prefix (that prefix = bundled into browser JS) and must
  **never** appear in frontend code.

## 3. Apply the database migrations

Four SQL files in `supabase/migrations/` define the entire schema — tables,
enums, queue RPCs, RLS policies, triggers. They **must run in order and in
full** (0003 references `usage_events`, which 0004 creates; plpgsql resolves
it at first call).

### Option A — SQL Editor (no tools needed)

1. Dashboard → **SQL Editor** → **New query**.
2. Open `supabase/migrations/0001_init_core.sql`, copy the **entire file**,
   paste, **Run**. Expect `Success. No rows returned`.
3. Repeat for `0002_projects_script.sql`, `0003_queue.sql`,
   `0004_usage_assets.sql` — in that order.

### Option B — Supabase CLI (if you have it)

```bash
npm install -g supabase   # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>   # the xxxx in your URL
supabase db push                                 # applies supabase/migrations/
```

### What the migrations give you

- `0001` — workspaces, profiles, memberships + a trigger that
  **auto-creates a personal workspace for every new signup** (no manual
  seeding; the very first user is instantly an owner).
- `0002` — projects, immutable script versions (audit trail of what the AI
  *actually* produced), scenes, and the reorder RPC.
- `0003` — the Postgres-backed job queue: atomic claims
  (`FOR UPDATE SKIP LOCKED`), heartbeats, cancel, retry with exponential
  backoff, crash-reclaim, and the single atomic completion RPC. Plus a
  partial unique index that makes double-queueing the same project
  structurally impossible.
- `0004` — usage accounting (real vs. mock requests, monthly report) and the
  asset registry for Phase 2.

## 4. Verify

```bash
# .env must have INT=1 for this to do anything (it silently skips otherwise)
npm run test:int
```

You should see the integration suite create two throwaway users, run claims,
cancels, retries, reorders, and a full script-generation completion, then
clean up after itself (it deletes the workspace rows and auth users it
created; rows are tagged `int-<runId>` if you ever need to hunt leftovers).

If this passes, auth + RLS + the queue all work against your real project.

## 5. Day-to-day notes

- **Schema changes** during development: since migrations have already run,
  edit the **next** migration file, or (dev only) drop everything in the SQL
  Editor and re-run 0001→0004. Supabase community convention for hard resets:
  truncate/recreate the affected tables, then re-run the files in order.
- **Auth emails**: signups are email-confirmed by default. For testing,
  integration tests use `admin.createUser` with `email_confirm: true`, and
  you can also confirm users manually under **Authentication → Users**.
- **Row Level Security**: every table has it enabled; the anon key can never
  read another workspace's data (see `docs/architecture.md` for the exact
  policy matrix and the reasons behind the odd-looking cascade policies).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `DbConfigurationError` at boot | Missing URL/anon/service key, or a `YOUR_` placeholder left in `.env` |
| `permission denied for function claim_jobs` | Called with the anon/session client instead of the service key (by design) |
| `editor role required` from a user RPC | The caller isn't at least an editor of that job's workspace (by design) |
| 409 on project "Generate" | A script.generate job is already pending/running for that project — expected; the UI surfaces it |
| Integration tests "skip" silently | `INT` is not `1` in `.env`, or a Supabase var is missing |
