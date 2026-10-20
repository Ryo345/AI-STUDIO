import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiError, type GeneratedScript } from '@studio/domain';

import {
  integrationTestEnvAvailable,
  appendJobEvent,
  claimJobs,
  completeScriptGeneration,
  createServiceClient,
  heartbeatJob,
  jobFailed,
  listJobEvents,
  loadDbConfig,
  reclaimStaleJobs,
  enqueueScriptGeneration,
  requestJobCancel,
  reorderScenes,
  retryJob,
} from '../index.js';

// GATED integration suite — runs ONLY with INT=1 plus real Supabase env in
// .env (see docs/supabase-setup.md): `npm run test:int`. Creates throwaway
// rows tagged `int-<runId>`; workspaces cascade-deleted in afterAll.
//
// This is the only tier that exercises actual Postgres/RLS/RPC behavior —
// the credential-free suite cannot see any of it (the service key bypasses
// RLS, so unit tests would lie about RLS).
//
// Client routing mirrors production:
//   * worker RPCs (claim/heartbeat/fail/reclaim/complete/append_event)
//     → SERVICE client (service_role-only grants)
//   * user-facing RPCs (cancel/retry/reorder) + RLS inserts
//     → userA's SESSION client, on rows in A's own workspace
//     (has_workspace_role resolves auth.uid(); the service key has none)

const ready = integrationTestEnvAvailable();
const runId = process.pid.toString(36) + Math.random().toString(36).slice(2, 6);

describe.skipIf(!ready)('migrations + queue RPCs (integration)', () => {
  let service!: SupabaseClient;
  let userA!: SupabaseClient; // owner of its handle_new_user-bootstrap workspace
  let userB!: SupabaseClient; // unrelated second user (forbidden-path checks)
  let aUserId = '';
  let bUserId = '';
  let aWorkspaceId = '';
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  const iso = (t: number | Date) => new Date(t).toISOString();

  // ── seed helpers (all rows tagged int-<runId>) ──────────────────────────

  async function seedWorkspace(name: string): Promise<string> {
    const { data, error } = await service
      .from('workspaces')
      .insert({ name: `int-${runId}-${name}` })
      .select('id')
      .single();
    if (error) throw error;
    createdWorkspaceIds.push(data.id);
    return data.id;
  }

  async function seedProject(workspaceId: string, topic: string): Promise<string> {
    const { data, error } = await service
      .from('projects')
      .insert({
        workspace_id: workspaceId,
        title: `int-${runId}-${topic}`,
        niche_key: 'horror',
        topic,
        config: { aspectRatio: '9:16', targetDurationSeconds: 90, format: 'narrative' },
        status: 'generating',
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }

  async function seedPendingJob(workspaceId: string, projectId: string): Promise<string> {
    const { data, error } = await service
      .from('jobs')
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        type: 'script.generate',
        payload: {},
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }

  async function seedScenes(projectId: string, count: number): Promise<string[]> {
    const rows = Array.from({ length: count }, (_, position) => ({
      project_id: projectId,
      position,
      narration: `int-${runId} scene ${position}`,
      visual_description: 'dark frame',
      duration_ms: 3000,
    }));
    const { data, error } = await service.from('scenes').insert(rows).select('id, position');
    if (error) throw error;
    return (data ?? []).sort((a, b) => a.position - b.position).map((row) => row.id);
  }

  function scriptFixture(): GeneratedScript {
    const scene = (index: number) => ({
      beatId: index === 0 ? 'hook' : 'context',
      index,
      summary: `fixture scene ${index}`,
      narration: `int-${runId} narration ${index}.`,
      visualDescription: 'A dark, quiet establishing frame.',
      onScreenText: index === 0 ? 'WHY?' : null,
      onScreenTextStrategy: index === 0 ? ('question' as const) : ('none' as const),
      durationMs: 3000,
      soundCues: [],
    });
    return {
      title: `int-${runId} fixture`,
      scenes: [scene(0), scene(1), scene(2)],
      totalDurationMs: 9000,
    };
  }

  beforeAll(async () => {
    const cfg = loadDbConfig();
    service = createServiceClient(cfg);

    const anonKey = String(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY,
    );
    const password = `Int-Test-${runId}-a9!`;

    // Two throwaway users; handle_new_user bootstrap must fire for each.
    for (const name of ['a', 'b']) {
      const email = `int-${runId}-${name}@example.invalid`;
      const { data, error } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw error;
      createdUserIds.push(data.user!.id);

      const userClient = createClient(cfg.url, anonKey, {
        auth: { persistSession: false },
      });
      const { error: signInError } = await userClient.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      if (name === 'a') userA = userClient;
      else userB = userClient;
    }
    aUserId = createdUserIds[0]!;
    bUserId = createdUserIds[1]!;

    // Both users' auto-created workspaces are tracked so afterAll can clean up.
    for (const userId of createdUserIds) {
      const { data: membership, error: membershipError } = await service
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', userId)
        .limit(1);
      if (membershipError) throw membershipError;
      const autoWorkspace = membership?.[0]?.workspace_id;
      if (!autoWorkspace) throw new Error('handle_new_user did not create a workspace');
      createdWorkspaceIds.push(autoWorkspace);
    }
    aWorkspaceId = createdWorkspaceIds[0]!;
  });

  afterAll(async () => {
    // Workspace deletes cascade projects → script_versions/scenes/jobs →
    // job_events, plus usage_events/assets directly; auth users are removed
    // separately (handle_new_user would just re-create rows otherwise).
    if (createdWorkspaceIds.length) {
      await service.from('workspaces').delete().in('id', createdWorkspaceIds);
    }
    for (const uid of [...createdUserIds].reverse()) {
      await service.auth.admin.deleteUser(uid);
    }
  });

  // ── 0001: signup bootstrap + RLS isolation ──────────────────────────────

  it('handle_new_user bootstrapped profile + workspace + owner membership', async () => {
    const { data: profile } = await service
      .from('profiles')
      .select('display_name, email')
      .eq('id', aUserId)
      .single();
    expect(profile?.email).toBe(`int-${runId}-a@example.invalid`);

    const { data: members } = await service
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', aWorkspaceId)
      .eq('user_id', aUserId)
      .single();
    expect(members?.role).toBe('owner');
  });

  it('RLS: user A sees its own project and nothing of other workspaces', async () => {
    const otherWs = await seedWorkspace('b-only');
    const bProjectId = await seedProject(otherWs, 'b-secret');
    const aProjectId = await seedProject(aWorkspaceId, 'a-visible');

    const { data: visible } = await userA.from('projects').select('id').eq('id', aProjectId);
    expect(visible).toHaveLength(1);

    const { data: hidden } = await userA.from('projects').select('id').eq('id', bProjectId);
    expect(hidden).toHaveLength(0);
  });

  // ── jobs RLS carve-outs + enqueue contract ──────────────────────────────

  it('enqueueScriptGeneration: RLS insert ok for A; B is forbidden; second enqueue → 409', async () => {
    const projectId = await seedProject(aWorkspaceId, 'enqueue');

    const first = await enqueueScriptGeneration(userA, {
      workspaceId: aWorkspaceId,
      projectId,
      createdBy: aUserId,
      payload: {},
    });
    expect(first.status).toBe('pending');
    expect(first.projectId).toBe(projectId);

    // Unrelated user cannot smuggle a job into A's workspace (RLS with
    // check) — even attributing it to their OWN id: membership is the gate.
    await expect(
      enqueueScriptGeneration(userB, {
        workspaceId: aWorkspaceId,
        projectId,
        createdBy: bUserId,
        payload: {},
      }),
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<ApiError>);

    // Partial unique index: double enqueue is structurally impossible.
    await expect(
      enqueueScriptGeneration(userA, {
        workspaceId: aWorkspaceId,
        projectId,
        createdBy: aUserId,
        payload: {},
      }),
    ).rejects.toMatchObject({ code: 'unique_active_job' } satisfies Partial<ApiError>);

    // Drain so later tests' claims start from a quiet queue.
    await claimJobs(service, 'drain-worker', 10);
  });

  // ── claim / reclaim / heartbeat ─────────────────────────────────────────

  it('claim_jobs: parallel claims are disjoint (SKIP LOCKED works)', async () => {
    const ws = await seedWorkspace('claims');
    const p1 = await seedProject(ws, 'claim-a');
    const p2 = await seedProject(ws, 'claim-b');
    const j1 = await seedPendingJob(ws, p1);
    const j2 = await seedPendingJob(ws, p2);

    const [batchA, batchB] = await Promise.all([
      claimJobs(service, 'workerA', 5),
      claimJobs(service, 'workerB', 5),
    ]);
    expect(batchA.length).toBeGreaterThan(0);

    const idsA = new Set(batchA.map((j) => j.id));
    const idsB = new Set(batchB.map((j) => j.id));
    for (const id of idsA) expect(idsB.has(id)).toBe(false); // never the same row twice
    expect([...idsA, ...idsB]).toEqual(expect.arrayContaining([j1, j2]));
  });

  it('reclaim_stale_jobs: attempt untouched, reclaimed_count escalates to terminal', async () => {
    const ws = await seedWorkspace('reclaim');
    const projectId = await seedProject(ws, 'reclaim');
    const jobId = await seedPendingJob(ws, projectId);

    // Fake a worker that claimed and then died 30 minutes ago.
    const stale = iso(Date.now() - 30 * 60_000);
    await service
      .from('jobs')
      .update({ status: 'running', locked_by: 'dead-worker', locked_at: stale })
      .eq('id', jobId);

    const reclaimed = await reclaimStaleJobs(service, 300);
    expect(reclaimed).toBeGreaterThanOrEqual(1);

    const { data: job } = await service.from('jobs').select('*').eq('id', jobId).single();
    expect(job.status).toBe('pending'); // crash ≠ provider failure: back to the queue
    expect(job.attempt).toBe(0); // ...and attempts are not burned
    expect(job.reclaimed_count).toBeGreaterThanOrEqual(1);

    // Two more stale cycles: rc hits 3 and the SAME sweep's offender step
    // settles the job as terminal failed/stale_lock.
    for (let i = 0; i < 2; i++) {
      await service
        .from('jobs')
        .update({ status: 'running', locked_by: 'dead-worker', locked_at: stale })
        .eq('id', jobId);
      await reclaimStaleJobs(service, 300);
    }
    const { data: dead } = await service.from('jobs').select('*').eq('id', jobId).single();
    expect(dead.status).toBe('failed');
    expect(dead.error.code).toBe('stale_lock');
  });

  it('heartbeat_job: true → cancel → false; foreign worker gets null', async () => {
    const projectId = await seedProject(aWorkspaceId, 'heartbeat');
    const jobId = await seedPendingJob(aWorkspaceId, projectId);
    const claimed = await claimJobs(service, 'hb-worker', 10);
    expect(claimed.some((j) => j.id === jobId)).toBe(true);

    // No cancel requested: keep working.
    expect(await heartbeatJob(service, jobId, 'hb-worker')).toBe(true);

    // Owner (session client, has_workspace_role path) requests a cancel.
    const cancelling = await requestJobCancel(userA, jobId);
    expect(cancelling.cancelRequested).toBe(true);

    expect(await heartbeatJob(service, jobId, 'hb-worker')).toBe(false); // honor cancel
    expect(await heartbeatJob(service, jobId, 'other-worker')).toBeNull(); // lock is not yours
  });

  // ── complete / fail / cancel / retry ────────────────────────────────────

  it('complete_script_generation: one RPC writes version+scenes+usage; duplicate call no-ops', async () => {
    const projectId = await seedProject(aWorkspaceId, 'complete');
    const jobId = await seedPendingJob(aWorkspaceId, projectId);
    const claimed = await claimJobs(service, 'c-worker', 10);
    expect(claimed.some((j) => j.id === jobId)).toBe(true);

    // Per-stage progress marks land through the lock-guarded RPC.
    await appendJobEvent(service, jobId, 'c-worker', 'stage', {
      stage: 'script-validated',
      scenes: 3,
    });

    const script = scriptFixture();
    const done = await completeScriptGeneration(service, {
      jobId,
      workerId: 'c-worker',
      script,
      provenance: {
        providerId: 'mock',
        model: null,
        isMock: true,
        seed: `${projectId}:1`,
        latencyMs: 12,
      },
      result: { versionNumber: 1, sceneCount: 3, totalDurationMs: 9000, providerId: 'mock', isMock: true },
      usage: { providerId: 'mock', operation: 'script.generate', isMock: true },
    });
    expect(done?.status).toBe('succeeded');

    const { data: project } = await service.from('projects').select('*').eq('id', projectId).single();
    expect(project?.status).toBe('ready');
    expect(project?.current_script_version_id).toBeTruthy();

    const { data: scenes } = await service.from('scenes').select('*').eq('project_id', projectId);
    expect(scenes).toHaveLength(3);

    const { data: usage } = await service.from('usage_events').select('*').eq('job_id', jobId);
    expect(usage).toHaveLength(1);
    expect(usage?.[0]?.is_mock).toBe(true);

    const events = await listJobEvents(service, jobId);
    expect(events.some((e) => e.kind === 'succeeded')).toBe(true);
    expect(
      events.some((e) => e.kind === 'stage' && (e.detail as Record<string, unknown>).stage === 'script-validated'),
    ).toBe(true);

    // Guard: a duplicate completion must NOT create a second version — the
    // row comes back unchanged (its result still says the first completion).
    const duplicate = await completeScriptGeneration(service, {
      jobId,
      workerId: 'c-worker',
      script,
      provenance: { providerId: 'mock', model: null, isMock: true, seed: 'x', latencyMs: 1 },
      result: { versionNumber: 2, sceneCount: 3, totalDurationMs: 9000, providerId: 'mock', isMock: true },
      usage: { providerId: 'mock', operation: 'script.generate', isMock: true },
    });
    expect(duplicate?.status).toBe('succeeded');
    expect(duplicate?.result?.versionNumber).toBe(1); // second write discarded

    const { count: versionCount } = await service
      .from('script_versions')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);
    expect(versionCount).toBe(1);
  });

  it('script_versions is immutable: direct UPDATE raises (trigger)', async () => {
    const projectId = await seedProject(aWorkspaceId, 'immutable');
    const jobId = await seedPendingJob(aWorkspaceId, projectId);
    const claimed = await claimJobs(service, 'i-worker', 10);
    expect(claimed.some((j) => j.id === jobId)).toBe(true);

    await completeScriptGeneration(service, {
      jobId,
      workerId: 'i-worker',
      script: scriptFixture(),
      provenance: { providerId: 'mock', model: null, isMock: true, seed: `${projectId}:1`, latencyMs: 1 },
      result: { versionNumber: 1, sceneCount: 3, totalDurationMs: 9000, providerId: 'mock', isMock: true },
      usage: { providerId: 'mock', operation: 'script.generate', isMock: true },
    });

    const { data: version } = await service
      .from('script_versions')
      .select('id')
      .eq('project_id', projectId)
      .single();

    if (!version) throw new Error('completion did not create a script version');
    const { error: updateError } = await service
      .from('script_versions')
      .update({ provenance: { hacked: true } })
      .eq('id', version.id);
    expect(updateError).toBeTruthy(); // the trigger, even for the service key
  });

  it('job_failed → backoff retry (run_at gates re-claim) → terminal after maxAttempts; retry_job resets', async () => {
    const projectId = await seedProject(aWorkspaceId, 'failed');
    const jobId = await seedPendingJob(aWorkspaceId, projectId);

    let last: Awaited<ReturnType<typeof jobFailed>> = null;
    for (let n = 1; n <= 3; n++) {
      // Simulate the backoff elapsing so claim_jobs (run_at <= now()) re-picks.
      if (n > 1) {
        await service.from('jobs').update({ run_at: iso(new Date()) }).eq('id', jobId);
      }
      const claimedBatch = await claimJobs(service, 'f-worker', 10);
      expect(claimedBatch.some((j) => j.id === jobId)).toBe(true);
      last = await jobFailed(service, jobId, 'f-worker', {
        code: 'provider_error',
        message: 'upstream 500',
      });
      if (n < 3) expect(last?.status).toBe('pending'); // requeued with backoff
    }
    expect(last?.status).toBe('failed');
    expect(last?.attempt).toBe(3);

    const { data: project } = await service.from('projects').select('status').eq('id', projectId).single();
    expect(project?.status).toBe('draft'); // reverted: no earlier version exists

    // Owner retries through the session client: fresh attempt budget.
    const retried = await retryJob(userA, jobId);
    expect(retried.status).toBe('pending');
    expect(retried.attempt).toBe(0);
    expect(retried.error).toBeNull();

    // Retrying a non-terminal job → 55000 → ApiError conflict.
    await expect(retryJob(userA, jobId)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('request_job_cancel on a queued job: cancelled + project reverts to editing when a version exists', async () => {
    const projectId = await seedProject(aWorkspaceId, 'cancel');
    const jobId = await seedPendingJob(aWorkspaceId, projectId);

    // One historical version → the revert must land on 'editing', not 'draft'.
    const { error: versionError } = await service.from('script_versions').insert({
      project_id: projectId,
      version_number: 1,
      generated_script: scriptFixture(),
      provenance: { providerId: 'mock', model: null, isMock: true, seed: 'x', latencyMs: 1 },
    });
    if (versionError) throw versionError;

    const cancelled = await requestJobCancel(userA, jobId);
    expect(cancelled.status).toBe('cancelled');

    const { data: project } = await service.from('projects').select('status').eq('id', projectId).single();
    expect(project?.status).toBe('editing');
  });

  // ── reorder ─────────────────────────────────────────────────────────────

  it('reorder_scenes: valid order renumbers; foreign/duplicate ids reject as validation_error', async () => {
    const p1 = await seedProject(aWorkspaceId, 'reorder-main');
    const otherWs = await seedWorkspace('reorder-other');
    const p2 = await seedProject(otherWs, 'reorder-foreign');
    const ids1 = await seedScenes(p1, 3);
    const ids2 = await seedScenes(p2, 3);

    // Smuggled foreign id → validation failure.
    const foreignId = ids2[0]!;
    await expect(
      reorderScenes(userA, p1, [...ids1.slice(0, 2), foreignId]),
    ).rejects.toMatchObject({ code: 'validation_error' });

    // Duplicate id → validation failure.
    await expect(
      reorderScenes(userA, p1, [ids1[0]!, ids1[0]!, ids1[1]!]),
    ).rejects.toMatchObject({ code: 'validation_error' });

    // Valid reverse order → positions follow the given order.
    await reorderScenes(userA, p1, [...ids1].reverse());
    const { data: scenes } = await service.from('scenes').select('id, position').eq('project_id', p1);
    const positionOf = new Map((scenes ?? []).map((s) => [s.id, s.position] as const));
    expect(positionOf.get(ids1[0]!)).toBe(2);
    expect(positionOf.get(ids1[2]!)).toBe(0);
  });
});
