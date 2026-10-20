-- 0003_queue.sql — Postgres-backed job queue (no Redis in this environment).
-- Worker = service role ONLY, and only through the SECURITY DEFINER RPCs
-- below. Web requests NEVER run provider calls; they only enqueue.
--
-- Invariants encoded here:
--   * claim_jobs is a single atomic statement (SKIP LOCKED) — never two calls.
--   * heartbeat_job uses server-side now() and fuses the cancel poll:
--     it returns cancel_requested in the same round-trip.
--   * Stale reclaim does NOT burn an attempt (crashes ≠ provider failures),
--     but reclaimed_count >= 3 escalates to terminal failed.
--   * retry_job resets attempt AND reclaimed_count; the partial unique
--     index turns a conflicting retry into 23505, which the API maps to 409.
--   * complete_script_generation is the ONLY writer of script versions,
--     current_script_version_id, project readiness, scenes, and the usage
--     event — one atomic RPC because supabase-js has no transactions.

create type public.job_status as enum ('pending', 'running', 'succeeded', 'failed', 'cancelled');
-- Phase 2 appends values ('voiceover.generate', 'media.resolve', 'render.video', ...)
-- in a dedicated ALTER TYPE migration BEFORE any code references them.
create type public.job_type as enum ('script.generate');

-- ── Tables ──────────────────────────────────────────────────────────────

create table public.jobs (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  project_id       uuid references public.projects (id) on delete cascade, -- null: Phase 3 non-project jobs
  type             public.job_type not null,
  status           public.job_status not null default 'pending',
  payload          jsonb not null default '{}'::jsonb,
  result           jsonb,
  error            jsonb,
  attempt          integer not null default 0 check (attempt >= 0),
  max_attempts     integer not null default 3 check (max_attempts between 1 and 10),
  run_at           timestamptz not null default now(),
  -- "host:pid:rand" worker instance id — deliberately NOT an FK: workers die.
  locked_by        text,
  locked_at        timestamptz,
  cancel_requested boolean not null default false,
  reclaimed_count  integer not null default 0 check (reclaimed_count >= 0),
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  updated_at       timestamptz not null default now()
);

-- Double-queueing one script.generate per project is structurally impossible.
create unique index jobs_one_active_script_generate
  on public.jobs (project_id)
  where type = 'script.generate' and status in ('pending', 'running');

create index jobs_poll_idx     on public.jobs (run_at) where status = 'pending';
create index jobs_ws_created    on public.jobs (workspace_id, created_at desc);
create index jobs_project_idx   on public.jobs (project_id, created_at desc);

create table public.job_events (
  id      uuid primary key default gen_random_uuid(),
  job_id  uuid not null references public.jobs (id) on delete cascade,
  -- claimed | cancel_requested | cancelled | retry_scheduled |
  -- retry_requested | failed | succeeded | reclaimed | stale_lock | stage
  -- (stage rows are written by append_job_event below: worker progress marks)
  kind    text not null,
  detail  jsonb not null default '{}'::jsonb,
  at      timestamptz not null default now()
);

create index job_events_job_idx on public.job_events (job_id, at desc);

create trigger jobs_touch
  before update on public.jobs
  for each row execute function public.tg_touch_updated_at();

-- ── Shared helper: project status revert after a job dies ────────────────
-- Called only from definer RPCs. A project whose script attempt failed
-- returns to 'editing' when an earlier version exists (its scenes are
-- intact), or to 'draft' when it has never had a script. Only acts while
-- the project still believes it is 'generating' — never clobbers a later
-- user-driven state.

create or replace function public.revert_generating_project(p_project_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.projects p
  set status = case
    when exists (
      select 1 from public.script_versions sv where sv.project_id = p.id
    ) then 'editing'::public.project_status
    else 'draft'::public.project_status
  end
  where p.id = p_project_id
    and p.status = 'generating';
$$;

revoke execute on function public.revert_generating_project(uuid) from public, anon, authenticated;

-- ── Worker RPCs (service_role ONLY) ─────────────────────────────────────

-- Atomic batch claim. FOR UPDATE SKIP LOCKED inside one statement means a
-- second worker can never claim the same row; a two-call claim (select then
-- update) would race. attempt is NOT incremented here — attempts count
-- genuine provider failures (job_failed), not claims.
--
-- All data-modifying CTEs below execute exactly once each (documented
-- PostgreSQL semantics), making this a claim + audit-event single step.
create or replace function public.claim_jobs(
  p_worker_id text,
  p_limit     integer default 2
)
returns setof public.jobs
language sql
security definer
set search_path = public
as $$
  with picked as (
    select j.id
    from public.jobs j
    where j.status = 'pending'
      and j.run_at <= now()
      -- queued cancels settle at the next reclaim sweep; claiming them here
      -- would only burn a claim → provider-call → cancel cycle
      and not j.cancel_requested
    order by j.run_at
    limit least(greatest(coalesce(p_limit, 2), 1), 10)
    for update skip locked
  ),
  claimed as (
    update public.jobs jj
    set status     = 'running',
        locked_by  = p_worker_id,
        locked_at  = now(),
        started_at = coalesce(jj.started_at, now()),
        updated_at = now()
    where jj.id in (select id from picked)
    returning jj.*
  ),
  claimed_events as (
    insert into public.job_events (job_id, kind, detail)
    select id, 'claimed', jsonb_build_object('worker', p_worker_id)
    from claimed
  )
  select * from claimed;
$$;

revoke execute on function public.claim_jobs(text, integer) from public, anon, authenticated;
grant execute on function public.claim_jobs(text, integer) to service_role;

-- Fused heartbeat + cancel poll. Updates locked_at with the server clock
-- (never a client timestamp) and returns cancel_requested. Zero rows means
-- the lock is gone (stolen by reclaim, or the job/project was deleted) —
-- the worker MUST treat that as "stop work, discard everything".
create or replace function public.heartbeat_job(
  p_job_id     uuid,
  p_worker_id  text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  with beat as (
    update public.jobs j
    set locked_at = now(), updated_at = now()
    where j.id = p_job_id
      and j.status = 'running'
      and j.locked_by = p_worker_id
    returning j.cancel_requested
  )
  select cancel_requested from beat;
$$;

revoke execute on function public.heartbeat_job(uuid, text) from public, anon, authenticated;
grant execute on function public.heartbeat_job(uuid, text) to service_role;

-- Worker-side failure path. attempt counts genuine failures; backoff is
-- 30·2^attempt capped at 600s (mirrored by @studio/queue-core backoff()).
-- NOTE: attempt in that formula is the POST-increment number — the first
-- retry backs off 60s, not 30s; the @studio/queue-core port must match.
-- A job that failed with cancel_requested settles as cancelled, not failed.
create or replace function public.job_failed(
  p_job_id     uuid,
  p_worker_id  text,
  p_error      jsonb
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job      public.jobs%rowtype;
  v_attempt  integer;
begin
  select * into v_job from public.jobs where id = p_job_id for update;

  if v_job.id is null then
    return null;
  end if;

  -- Lock stolen (reclaim decided this worker is dead) → the reclaim path
  -- owns the job now; do not overwrite its state, just report the row.
  if v_job.status <> 'running' or v_job.locked_by is distinct from p_worker_id then
    return v_job;
  end if;

  v_attempt := v_job.attempt + 1;

  -- Retryable errors spend the budget; a deterministic provider rejection
  -- (retryable=false: content-policy 400, bad model id) goes terminal on
  -- the spot instead of paying for doomed attempts. The wrapper's error
  -- object carries the flag; absent = retryable, so timeouts and generic
  -- errors keep the historic always-retry behavior.
  if v_attempt < v_job.max_attempts
     and not v_job.cancel_requested
     and coalesce(p_error ->> 'retryable', 'true')::boolean then
    update public.jobs j
    set status      = 'pending',
        attempt     = v_attempt,
        error       = p_error,
        locked_by   = null,
        locked_at   = null,
        run_at      = now() + make_interval(secs => least(30 * 2 ^ v_attempt, 600))
    where j.id = p_job_id
    returning * into v_job;

    insert into public.job_events (job_id, kind, detail)
    values (p_job_id, 'retry_scheduled', jsonb_build_object(
      'attempt',        v_attempt,
      'retryInSeconds', least(30 * 2 ^ v_attempt, 600),
      'error',          p_error
    ));
  else
    update public.jobs j
    set status      = case when v_job.cancel_requested then 'cancelled' else 'failed' end,
        attempt     = v_attempt,
        error       = case when v_job.cancel_requested then coalesce(v_job.error, p_error) else p_error end,
        locked_by   = null,
        locked_at   = null,
        finished_at = now()
    where j.id = p_job_id
    returning * into v_job;

    insert into public.job_events (job_id, kind, detail)
    values (
      p_job_id,
      case when v_job.cancel_requested then 'cancelled' else 'failed' end,
      jsonb_build_object('attempt', v_attempt, 'error', p_error)
    );

    perform public.revert_generating_project(v_job.project_id);
  end if;

  return v_job;
end;
$$;

revoke execute on function public.job_failed(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.job_failed(uuid, text, jsonb) to service_role;

-- Called once at worker boot and on a ~60s interval. Locks older than
-- p_stale_seconds (server clock) return to pending WITHOUT burning an
-- attempt (a crash is not a provider failure), but reclaimed_count
-- escalates repeat offenders to terminal failed. Also settles pending
-- jobs whose user cancelled while they sat queued.
create or replace function public.reclaim_stale_jobs(
  p_stale_seconds integer default 300
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_total integer := 0;
begin
  -- 1) queued cancels: pending + cancel_requested → cancelled now
  with settled as (
    update public.jobs
    set status          = 'cancelled',
        cancel_requested = true,
        error           = jsonb_build_object('code', 'cancelled', 'message', 'Cancelled before start'),
        locked_by       = null,
        finished_at     = now()
    where status = 'pending' and cancel_requested
    returning *
  ),
  settled_events as (
    insert into public.job_events (job_id, kind, detail)
    select id, 'cancelled', jsonb_build_object('reason', 'queued_cancel_settled') from settled
  ),
  settled_projects as (
    update public.projects p
    set status = case
      when exists (select 1 from public.script_versions sv where sv.project_id = p.id)
        then 'editing'::public.project_status
        else 'draft'::public.project_status
    end
    where p.status = 'generating'
      and p.id in (select project_id from settled where project_id is not null)
  )
  select count(*) into v_count from settled;
  v_total := v_total + v_count;

  -- 2) stale running locks → back to pending, attempt preserved
  with reclaimed as (
    update public.jobs
    set status         = 'pending',
        locked_by      = null,
        locked_at     = null,
        run_at        = now(),
        reclaimed_count = reclaimed_count + 1
    where status = 'running'
      and locked_at is not null
      and locked_at < now() - make_interval(secs => greatest(coalesce(p_stale_seconds, 300), 30))
    returning *
  ),
  reclaimed_events as (
    insert into public.job_events (job_id, kind, detail)
    select id, 'reclaimed', jsonb_build_object('reclaimedCount', reclaimed_count) from reclaimed
  )
  select count(*) into v_count from reclaimed;
  v_total := v_total + v_count;

  -- 3) repeat offenders: reclaimed 3+ times → terminal failed (stale_lock)
  with offenders as (
    update public.jobs
    set status      = 'failed',
        error       = jsonb_build_object('code', 'stale_lock', 'message', 'Worker crashed or stalled repeatedly'),
        locked_by   = null,
        locked_at   = null,
        finished_at = now()
    where status = 'pending' and reclaimed_count >= 3
    returning *
  ),
  offender_events as (
    insert into public.job_events (job_id, kind, detail)
    select id, 'stale_lock', jsonb_build_object('reclaimedCount', reclaimed_count) from offenders
  ),
  offender_projects as (
    update public.projects p
    set status = case
      when exists (select 1 from public.script_versions sv where sv.project_id = p.id)
        then 'editing'::public.project_status
        else 'draft'::public.project_status
    end
    where p.status = 'generating'
      and p.id in (select project_id from offenders where project_id is not null)
  )
  select count(*) into v_count from offenders;

  return v_total + v_count;
end;
$$;

revoke execute on function public.reclaim_stale_jobs(integer) from public, anon, authenticated;
grant execute on function public.reclaim_stale_jobs(integer) to service_role;

-- Worker progress marks ("save progress after every stage"): the sanctioned
-- way the worker writes job_events rows outside the lifecycle RPCs. Guarded
-- by the same lock contract (status='running' AND locked_by=p_worker_id), so
-- a stolen lock silently drops the mark, exactly like every other worker write.
create or replace function public.append_job_event(
  p_worker_id text,
  p_job_id    uuid,
  p_kind      text,
  p_detail    jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.job_events (job_id, kind, detail)
  select j.id, p_kind, coalesce(p_detail, '{}'::jsonb)
  from public.jobs j
  where j.id = p_job_id
    and j.status = 'running'
    and j.locked_by = p_worker_id;
$$;

revoke execute on function public.append_job_event(text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.append_job_event(text, uuid, text, jsonb) to service_role;

-- ── User-facing RPCs (authenticated; membership checked inside) ─────────

-- pending → cancelled immediately (project status reverted);
-- running  → cancel_requested = true, worker acks at its next heartbeat;
-- terminal → no-op, returns the row so the UI can render current truth.
create or replace function public.request_job_cancel(p_job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
begin
  select * into v_job from public.jobs where id = p_job_id for update;

  if v_job.id is null then
    raise exception 'job not found: %', p_job_id using errcode = 'P0002';
  end if;

  if not public.has_workspace_role(v_job.workspace_id, 'editor') then
    raise exception 'editor role required' using errcode = '42501';
  end if;

  if v_job.status = 'pending' then
    update public.jobs j
    set status          = 'cancelled',
        cancel_requested = true,
        error           = jsonb_build_object('code', 'cancelled', 'message', 'Cancelled before start'),
        locked_by       = null,
        locked_at       = null,
        finished_at     = now()
    where j.id = p_job_id
    returning * into v_job;

    insert into public.job_events (job_id, kind, detail)
    values (p_job_id, 'cancelled', jsonb_build_object('reason', 'cancelled_before_start'));

    perform public.revert_generating_project(v_job.project_id);

  elsif v_job.status = 'running' then
    update public.jobs j
    set cancel_requested = true
    where j.id = p_job_id
    returning * into v_job;

    insert into public.job_events (job_id, kind, detail)
    values (p_job_id, 'cancel_requested', jsonb_build_object('reason', 'user'));
  end if;

  return v_job;
end;
$$;

revoke execute on function public.request_job_cancel(uuid) from public, anon;
grant execute on function public.request_job_cancel(uuid) to authenticated, service_role;

-- Only failed/cancelled jobs can be retried (double-clicking retry can
-- never double-queue: the partial unique index raises 23505 → API 409).
-- attempt AND reclaimed_count reset: a retried job gets a fresh budget.
create or replace function public.retry_job(p_job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
begin
  select * into v_job from public.jobs where id = p_job_id for update;

  if v_job.id is null then
    raise exception 'job not found: %', p_job_id using errcode = 'P0002';
  end if;

  if not public.has_workspace_role(v_job.workspace_id, 'editor') then
    raise exception 'editor role required' using errcode = '42501';
  end if;

  if v_job.status not in ('failed', 'cancelled') then
    raise exception 'only failed or cancelled jobs can be retried (status: %)', v_job.status
      using errcode = '55000';
  end if;

  begin
    update public.jobs j
    set status          = 'pending',
        attempt         = 0,
        reclaimed_count = 0,
        error           = null,
        result          = null,
        cancel_requested = false,
        locked_by       = null,
        locked_at       = null,
        started_at      = null,
        finished_at     = null,
        run_at          = now()
    where j.id = p_job_id
    returning * into v_job;
  exception
    when unique_violation then
      raise exception 'an active script.generate job already exists for this project'
        using errcode = '23505';
  end;

  update public.projects
  set status = 'generating'
  where id = v_job.project_id;

  insert into public.job_events (job_id, kind, detail)
  values (p_job_id, 'retry_requested', jsonb_build_object('by', auth.uid()));

  return v_job;
end;
$$;

revoke execute on function public.retry_job(uuid) from public, anon;
grant execute on function public.retry_job(uuid) to authenticated, service_role;

-- ── THE atomic fulfillment RPC ──────────────────────────────────────────
-- supabase-js has no transactions, so every write that must happen
-- together happens inside this one definer function:
--   script_versions insert → projects.current_script_version_id + 'ready' →
--   scenes delete + reinsert → jobs succeeded → usage_events row.
-- Guarded on (status='running' AND locked_by=worker): if the lock was
-- stolen by reclaim, this is a no-op returning the current row — the
-- worker logs the discarded truth instead of reporting false success.
-- Returns NULL when the job row itself is gone (project deleted mid-run
-- cascades to the job): same "discard everything" signal heartbeat_job
-- gives for a vanished lock, so the worker has ONE uniform contract.

create or replace function public.complete_script_generation(
  p_job_id      uuid,
  p_worker_id   text,
  p_script      jsonb,
  p_provenance  jsonb,
  p_result      jsonb,
  p_usage       jsonb
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job     public.jobs%rowtype;
  v_version integer;
  v_sv_id   uuid;
  v_exists  boolean;
begin
  select * into v_job from public.jobs where id = p_job_id for update;

  -- Job row vanished (project deleted mid-run deletes the job via CASCADE):
  -- NULL, the uniform stolen-lock signal (see header comment).
  if v_job.id is null then
    return null;
  end if;

  -- Stolen lock / settled otherwise: complete nothing, report the row.
  if v_job.status <> 'running' or v_job.locked_by is distinct from p_worker_id then
    return v_job;
  end if;

  -- script.generate always carries a project (Phase 3 null-project jobs get
  -- their own RPCs) — refuse loudly instead of mislabeling 'project_deleted'.
  if v_job.project_id is null then
    raise exception 'script.generate jobs must reference a project' using errcode = '22023';
  end if;

  -- Project deleted mid-run AND the job survived it: discard work, settle.
  select exists (select 1 from public.projects where id = v_job.project_id) into v_exists;
  if not v_exists then
    update public.jobs j
    set status      = 'failed',
        error       = jsonb_build_object('code', 'project_deleted', 'message', 'Project no longer exists'),
        locked_by   = null,
        locked_at   = null,
        finished_at = now()
    where j.id = p_job_id
    returning * into v_job;
    return v_job;
  end if;

  -- Lock the project row BEFORE touching scenes: reorder_scenes locks
  -- project-then-scenes, and matching that order closes the only
  -- cross-RPC deadlock window (a 40P01 here would burn a full provider
  -- attempt for a race the provider already survived).
  perform 1 from public.projects p where p.id = v_job.project_id for update;

  select coalesce(max(version_number), 0) + 1 into v_version
  from public.script_versions
  where project_id = v_job.project_id;

  insert into public.script_versions (project_id, version_number, generated_script, provenance)
  values (v_job.project_id, v_version, p_script, p_provenance)
  returning id into v_sv_id;

  -- Regeneration clobbers scene edits deliberately (documented semantics —
  -- docs/architecture.md); the immutable version row above preserves the
  -- full generated history.
  delete from public.scenes
  where project_id = v_job.project_id;

  insert into public.scenes
    (project_id, position, origin_script_version_id,
     narration, visual_description, on_screen_text, duration_ms, sound_cues, meta)
  select v_job.project_id, e.ord - 1, v_sv_id,
         e.scene ->> 'narration',
         coalesce(e.scene ->> 'visualDescription', ''),
         e.scene ->> 'onScreenText',
         (e.scene ->> 'durationMs')::int,
         coalesce(e.scene -> 'soundCues', '[]'::jsonb),
         jsonb_build_object(
           'beatId',              e.scene ->> 'beatId',
           'summary',            e.scene ->> 'summary',
           'onScreenTextStrategy', e.scene ->> 'onScreenTextStrategy'
         )
  from jsonb_array_elements(p_script -> 'scenes') with ordinality as e(scene, ord);

  update public.projects p
  set current_script_version_id = v_sv_id,
      status = 'ready'
  where p.id = v_job.project_id;

  update public.jobs j
  set status      = 'succeeded',
      result      = p_result,
      error       = null,
      locked_by   = null,
      locked_at   = null,
      finished_at = now()
  where j.id = p_job_id
  returning * into v_job;

  insert into public.job_events (job_id, kind, detail)
  values (p_job_id, 'succeeded', p_result);

  -- usage_events is created in 0004; plpgsql resolves relation names at
  -- first call, NOT at CREATE FUNCTION time — safe only because migrations
  -- apply in order. Do not run 0003 standalone against a schema without 0004.
  insert into public.usage_events
    (workspace_id, project_id, job_id, provider_id, operation, quantity, unit, is_mock)
  values (
    v_job.workspace_id,
    v_job.project_id,
    p_job_id,
    p_usage ->> 'providerId',
    p_usage ->> 'operation',
    coalesce((p_usage ->> 'quantity')::numeric, 1),
    coalesce(p_usage ->> 'unit', 'request'),
    coalesce((p_usage ->> 'isMock')::boolean, false)
  );

  return v_job;
end;
$$;

revoke execute on function public.complete_script_generation(uuid, text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_script_generation(uuid, text, jsonb, jsonb, jsonb, jsonb)
  to service_role;

-- ── RLS ─────────────────────────────────────────────────────────────────
-- No jobs UPDATE policy exists on purpose: users mutate jobs only through
-- request_job_cancel / retry_job, and the worker through its RPCs. The
-- DELETE policy exists so project/workspace deletes cascade cleanly
-- through user-session clients.

alter table public.jobs        enable row level security;
alter table public.job_events  enable row level security;

create policy "jobs_member_read"
  on public.jobs for select to authenticated
  using (public.has_workspace_role(jobs.workspace_id, 'viewer'));

-- Cross-workspace smuggling guard: membership AND the referenced project
-- must belong to the SAME workspace the row claims.
-- Row-shape guard: a session-tier insert can only ever be a PRISTINE
-- enqueue. Post-claim state (locks, cancel marks, terminal statuses) is
-- worker-RPC-only truth — a forged row here would sit on the partial
-- unique active index and freeze the project's queue slot with no path
-- ever settling it. Counters start at zero for the same reason: a forged
-- reclaimed_count >= 3 would terminal-fail on the next reclaim sweep
-- without the job ever running. created_by is pinned to the caller, so
-- attribution cannot be laundered either.
create policy "jobs_editor_insert"
  on public.jobs for insert to authenticated
  with check (
    public.has_workspace_role(jobs.workspace_id, 'editor')
    and (
      jobs.project_id is null
      or jobs.workspace_id = (select p.workspace_id from public.projects p where p.id = jobs.project_id)
    )
    and jobs.status = 'pending'
    and jobs.attempt = 0
    and jobs.reclaimed_count = 0
    and jobs.locked_by is null
    and jobs.locked_at is null
    and not jobs.cancel_requested
    and jobs.created_by = auth.uid()
  );

create policy "jobs_owner_delete"
  on public.jobs for delete to authenticated
  using (public.has_workspace_role(jobs.workspace_id, 'owner'));

create policy "job_events_member_read"
  on public.job_events for select to authenticated
  using (
    public.has_workspace_role(
      (select j.workspace_id from public.jobs j where j.id = job_events.job_id),
      'viewer'
    )
  );

create policy "job_events_owner_delete"
  on public.job_events for delete to authenticated
  using (
    public.has_workspace_role(
      (select j.workspace_id from public.jobs j where j.id = job_events.job_id),
      'owner'
    )
  );
