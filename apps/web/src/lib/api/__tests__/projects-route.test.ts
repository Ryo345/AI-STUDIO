import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, ApiErrorEnvelopeSchema, type NicheKey } from '@studio/domain';

// The projects CRUD routes + GET /api/v1/providers, exercised through their
// real handlers, the real guard, and the real error envelope.
//
// Three collaborators are stubbed:
//
//   * createSupabaseServerClient() → auth.getUser()   (who the caller is)
//   * @studio/db query/RPC helpers                     (what the data layer does)
//   * @studio/niches resolveNiche                      (pass-through by default)
//
// The registry stays REAL otherwise — duration-band tests assert against the
// actual horror/gaming bands (60..175 / 30..120 at 9:16). resolveNiche is a
// pass-through vi.fn only so the "unknown niche" branch, unreachable with
// real data (the zod enum and the registry agree on every key), can still be
// exercised. Stubbing the Supabase client keeps the suite credential-free,
// matching session-route.test.ts.
const originalProviderEnv = process.env.SCRIPTWRITER_PROVIDER;

const harness = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  userError: null as { message: string } | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: harness.user },
        error: harness.userError,
      }),
    },
  }),
}));

const db = vi.hoisted(() => ({
  createProjectRow: vi.fn(),
  listProjects: vi.fn(),
  getProjectRow: vi.fn(),
  updateProjectRow: vi.fn(),
  deleteProjectRow: vi.fn(),
  hasActiveJob: vi.fn(),
  listActiveJobsByProject: vi.fn(),
  enqueueScriptGeneration: vi.fn(),
  getPrimaryWorkspaceId: vi.fn(),
}));

vi.mock('@studio/db', () => db);

const niches = vi.hoisted(() => ({
  resolveNiche: vi.fn(),
  real: null as null | typeof import('@studio/niches'),
}));

vi.mock('@studio/niches', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@studio/niches')>();
  niches.real = actual;
  return { ...actual, resolveNiche: niches.resolveNiche };
});

const { POST, GET: listGET } = await import('../../../app/api/v1/projects/route.js');
const { GET: getProjectGET, PATCH, DELETE } = await import(
  '../../../app/api/v1/projects/[id]/route.js'
);
const { GET: providersGET } = await import('../../../app/api/v1/providers/route.js');

const AUTHED_USER = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' };
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_PROJECT_ID = '34444444-4444-4444-8444-444444444444';
const JOB_ID = '45555555-5555-4555-8555-555555555555';

// The horror 9:16 band is 60..175 — the fixtures stay inside it so every
// test only moves the axis it is named for.
const BASE_CONFIG = { aspectRatio: '9:16', targetDurationSeconds: 90, format: 'narrative' } as const;

const CREATE_BODY = {
  niche: 'horror',
  topic: 'The lighthouse keeper walks at midnight',
  config: { ...BASE_CONFIG },
};

function draftProject(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    title: 'The lighthouse keeper walks at midnight',
    niche: 'horror',
    topic: CREATE_BODY.topic,
    config: { ...BASE_CONFIG },
    status: 'draft',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function pendingJob(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    type: 'script.generate',
    status: 'pending',
    attempt: 0,
    maxAttempts: 3,
    cancelRequested: false,
    error: null,
    result: null,
    createdAt: '2026-01-01T00:00:01Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function createRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function listRequest(query = ''): Request {
  return new Request(`http://localhost/api/v1/projects${query}`);
}

function idRequest(id: string, method = 'GET', body?: unknown): Request {
  return new Request(`http://localhost/api/v1/projects/${id}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function idParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function providersRequest(): Request {
  return new Request('http://localhost/api/v1/providers');
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  harness.user = { ...AUTHED_USER };
  harness.userError = null;

  for (const fn of Object.values(db)) fn.mockReset();

  db.getPrimaryWorkspaceId.mockResolvedValue(WORKSPACE_ID);
  db.createProjectRow.mockResolvedValue(draftProject());
  db.listProjects.mockResolvedValue([]);
  db.getProjectRow.mockResolvedValue(draftProject());
  db.updateProjectRow.mockResolvedValue(draftProject());
  db.deleteProjectRow.mockResolvedValue(true);
  db.hasActiveJob.mockResolvedValue(false);
  db.listActiveJobsByProject.mockResolvedValue(new Map());
  db.enqueueScriptGeneration.mockResolvedValue(pendingJob());

  niches.resolveNiche.mockReset();
  niches.resolveNiche.mockImplementation((key: NicheKey) => niches.real!.resolveNiche(key));
});

afterEach(() => {
  vi.restoreAllMocks();

  // Leave the ambient environment exactly as it was found.
  if (originalProviderEnv === undefined) delete process.env.SCRIPTWRITER_PROVIDER;
  else process.env.SCRIPTWRITER_PROVIDER = originalProviderEnv;
});

describe('POST /api/v1/projects', () => {
  it('answers 400 for a body that fails the schema, without echoing the submitted value', async () => {
    const response = await POST(createRequest({ niche: 'definitely-not-a-niche' }));

    expect(response.status).toBe(400);
    const envelope = ApiErrorEnvelopeSchema.parse(await bodyOf(response));
    expect(envelope.error.code).toBe('validation_error');
    expect(JSON.stringify(envelope)).not.toContain('definitely-not-a-niche');
    // The body is validated before the workspace is resolved.
    expect(db.getPrimaryWorkspaceId).not.toHaveBeenCalled();
  });

  it('answers 400 for an unknown niche without leaking the registry error', async () => {
    niches.resolveNiche.mockImplementationOnce(() => {
      throw new Error("No niche template registered for 'horror'");
    });

    const response = await POST(createRequest(CREATE_BODY));

    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ code: 'validation_error', message: 'unknown niche' });
    expect(JSON.stringify(body)).not.toContain('No niche template registered');
    expect(db.createProjectRow).not.toHaveBeenCalled();
  });

  it('answers 400 when the target duration falls outside the niche band', async () => {
    // Horror 9:16 accepts 60..175; 300 is a valid global duration (<= 3600)
    // that only the band check can catch.
    const response = await POST(
      createRequest({ ...CREATE_BODY, config: { ...BASE_CONFIG, targetDurationSeconds: 300 } }),
    );

    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ code: 'validation_error' });
    const message = (body.error as { message: string }).message;
    // The accepted range comes from the template, the submitted value never
    // comes back.
    expect(message).toContain('between 60 and 175');
    expect(JSON.stringify(body)).not.toContain('300');
    expect(db.createProjectRow).not.toHaveBeenCalled();
  });

  it('answers 403 when the caller holds no workspace membership', async () => {
    db.getPrimaryWorkspaceId.mockResolvedValue(null);

    const response = await POST(createRequest(CREATE_BODY));

    expect(response.status).toBe(403);
    expect(await bodyOf(response)).toEqual({
      error: { code: 'forbidden', message: 'no workspace membership found for this account' },
    });
    expect(db.createProjectRow).not.toHaveBeenCalled();
  });

  it('creates the project, enqueues, and flips to generating — in that order', async () => {
    const generating = draftProject({ status: 'generating' });
    db.updateProjectRow.mockResolvedValue(generating);

    const response = await POST(createRequest(CREATE_BODY));

    expect(response.status).toBe(201);
    expect(await bodyOf(response)).toEqual({
      data: { project: generating, job: pendingJob() },
    });

    // Hard carry-forward invariant (M2 architecture review): the enqueue
    // strictly precedes the status flip, so a 409 from a double enqueue
    // leaves the project in draft.
    expect(db.enqueueScriptGeneration.mock.invocationCallOrder[0]!).toBeLessThan(
      db.updateProjectRow.mock.invocationCallOrder[0]!,
    );

    expect(db.createProjectRow).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: WORKSPACE_ID,
      createdBy: AUTHED_USER.id,
      title: 'The lighthouse keeper walks at midnight', // derived from the topic (<= 60 chars)
      nicheKey: 'horror',
      topic: CREATE_BODY.topic,
      config: { ...BASE_CONFIG },
    });
    expect(db.enqueueScriptGeneration).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      createdBy: AUTHED_USER.id,
      payload: { instructions: undefined }, // config.instructions absent
    });
    expect(db.updateProjectRow).toHaveBeenCalledWith(expect.anything(), PROJECT_ID, {
      status: 'generating',
    });
    expect(db.deleteProjectRow).not.toHaveBeenCalled();
  });

  it('derives a word-boundary title from a long topic when no title is given', async () => {
    const topic = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen';
    // First 60 chars end mid-word ("twelv"); the derived title stops at the
    // last space before the cut.
    await POST(createRequest({ ...CREATE_BODY, topic }));

    expect(db.createProjectRow.mock.calls[0]?.[1].title).toBe(
      'one two three four five six seven eight nine ten eleven',
    );
  });

  it('creates without enqueueing when autoGenerate is false', async () => {
    const response = await POST(createRequest({ ...CREATE_BODY, autoGenerate: false }));

    expect(response.status).toBe(201);
    expect(await bodyOf(response)).toEqual({ data: { project: draftProject(), job: null } });
    expect(db.enqueueScriptGeneration).not.toHaveBeenCalled();
    expect(db.updateProjectRow).not.toHaveBeenCalled();
    expect(db.deleteProjectRow).not.toHaveBeenCalled();
  });

  it('rolls the project back and surfaces the enqueue error', async () => {
    db.enqueueScriptGeneration.mockRejectedValue(
      new ApiError(
        'unique_active_job',
        'A script generation job is already pending or running for this project',
      ),
    );

    const response = await POST(createRequest(CREATE_BODY));

    expect(response.status).toBe(409);
    expect(await bodyOf(response)).toEqual({
      error: {
        code: 'unique_active_job',
        message: 'A script generation job is already pending or running for this project',
      },
    });
    // The fresh draft is removed...
    expect(db.deleteProjectRow).toHaveBeenCalledWith(expect.anything(), PROJECT_ID);
    // ...and the status flip never happened.
    expect(db.updateProjectRow).not.toHaveBeenCalled();
  });

  it('rolls back and logs a non-Api enqueue failure without echoing it', async () => {
    db.enqueueScriptGeneration.mockRejectedValue(
      new Error('enqueueScriptGeneration failed: relation "jobs" does not exist'),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(createRequest(CREATE_BODY));

    expect(response.status).toBe(500);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ code: 'internal_error' });
    expect(JSON.stringify(body)).not.toContain('jobs');
    expect(errorSpy).toHaveBeenCalled();
    expect(db.deleteProjectRow).toHaveBeenCalledWith(expect.anything(), PROJECT_ID);
  });
});

describe('GET /api/v1/projects', () => {
  it('lists projects with their newest active job attached', async () => {
    const other = draftProject({ id: OTHER_PROJECT_ID, title: 'Second project', topic: 'second' });
    db.listProjects.mockResolvedValue([draftProject(), other]);
    db.listActiveJobsByProject.mockResolvedValue(new Map([[PROJECT_ID, [pendingJob()]]]));

    const response = await listGET(listRequest('?limit=2'));

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({
      data: {
        projects: [
          { ...draftProject(), activeJob: pendingJob() },
          { ...other, activeJob: null },
        ],
      },
    });
    // The job lookup is one batched call covering exactly the page's ids.
    expect(db.listActiveJobsByProject).toHaveBeenCalledWith(expect.anything(), [
      PROJECT_ID,
      OTHER_PROJECT_ID,
    ]);
    // limit arrives as text and is coerced.
    expect(db.listProjects.mock.calls[0]?.[2]).toMatchObject({ limit: 2, offset: 0 });
  });

  it('answers 403 when the caller holds no workspace membership', async () => {
    db.getPrimaryWorkspaceId.mockResolvedValue(null);

    const response = await listGET(listRequest());

    expect(response.status).toBe(403);
    expect(db.listProjects).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/projects/[id]', () => {
  it('returns the project with its active jobs', async () => {
    db.listActiveJobsByProject.mockResolvedValue(new Map([[PROJECT_ID, [pendingJob()]]]));

    const response = await getProjectGET(idRequest(PROJECT_ID), idParams(PROJECT_ID));

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({
      data: { project: draftProject(), activeJobs: [pendingJob()] },
    });
    expect(db.listActiveJobsByProject).toHaveBeenCalledWith(expect.anything(), [PROJECT_ID]);
  });

  it('answers 404 when RLS (or absence) hides the project', async () => {
    db.getProjectRow.mockResolvedValue(null);

    const response = await getProjectGET(idRequest(PROJECT_ID), idParams(PROJECT_ID));

    expect(response.status).toBe(404);
    expect(await bodyOf(response)).toEqual({
      error: { code: 'not_found', message: 'project not found' },
    });
  });

  it('answers 400 for a malformed id without echoing it', async () => {
    const response = await getProjectGET(idRequest('not-a-uuid'), idParams('not-a-uuid'));

    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ code: 'validation_error' });
    expect(JSON.stringify(body)).not.toContain('not-a-uuid');
    expect(db.getProjectRow).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/v1/projects/[id]', () => {
  it('merges a sparse config patch and revalidates the band', async () => {
    const merged = { ...BASE_CONFIG, targetDurationSeconds: 120 };
    db.updateProjectRow.mockResolvedValue(draftProject({ config: merged }));

    const response = await PATCH(
      idRequest(PROJECT_ID, 'PATCH', { title: 'New title', config: { targetDurationSeconds: 120 } }),
      idParams(PROJECT_ID),
    );

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({
      data: { project: draftProject({ config: merged }) },
    });
    // The data layer receives the WHOLE merged config, and only the keys the
    // caller actually sent.
    expect(db.updateProjectRow).toHaveBeenCalledWith(expect.anything(), PROJECT_ID, {
      title: 'New title',
      config: { aspectRatio: '9:16', targetDurationSeconds: 120, format: 'narrative' },
    });
  });

  it('answers 400 when the merged config fails the schema', async () => {
    const response = await PATCH(
      idRequest(PROJECT_ID, 'PATCH', { config: { targetDurationSeconds: 5 } }),
      idParams(PROJECT_ID),
    );

    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ code: 'validation_error' });
    expect(db.updateProjectRow).not.toHaveBeenCalled();
  });

  it('revalidates the band when a config-only patch breaks it', async () => {
    // Stored horror 9:16 (60..175) is in band; 10 passes the global schema
    // (>= 10) but only the band re-check can reject it.
    const response = await PATCH(
      idRequest(PROJECT_ID, 'PATCH', { config: { targetDurationSeconds: 10 } }),
      idParams(PROJECT_ID),
    );

    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    const message = (body.error as { message: string }).message;
    expect(message).toContain('between 60 and 175');
    expect(db.updateProjectRow).not.toHaveBeenCalled();
  });

  it('revalidates the band when a niche-only patch breaks it', async () => {
    // 175 sits exactly at horror's 9:16 maximum; gaming's band is 30..120.
    db.getProjectRow.mockResolvedValue(draftProject({ config: { ...BASE_CONFIG, targetDurationSeconds: 175 } }));

    const response = await PATCH(
      idRequest(PROJECT_ID, 'PATCH', { niche: 'gaming' }),
      idParams(PROJECT_ID),
    );

    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    const message = (body.error as { message: string }).message;
    expect(message).toContain('between 30 and 120');
    expect(db.updateProjectRow).not.toHaveBeenCalled();
  });

  it('answers 404 when RLS (or absence) hides the project', async () => {
    db.getProjectRow.mockResolvedValue(null);

    const response = await PATCH(
      idRequest(PROJECT_ID, 'PATCH', { title: 'renamed' }),
      idParams(PROJECT_ID),
    );

    expect(response.status).toBe(404);
    expect(await bodyOf(response)).toEqual({
      error: { code: 'not_found', message: 'project not found' },
    });
  });

  it('answers 404 when the update itself is RLS-denied (viewer role)', async () => {
    // The row was readable but the UPDATE returned null — the RLS policy for
    // updates requires editor, so a viewer's write looks identical to a
    // missing project.
    db.updateProjectRow.mockResolvedValue(null);

    const response = await PATCH(
      idRequest(PROJECT_ID, 'PATCH', { status: 'archived' }),
      idParams(PROJECT_ID),
    );

    expect(response.status).toBe(404);
    expect(await bodyOf(response)).toEqual({
      error: { code: 'not_found', message: 'project not found' },
    });
    expect(db.updateProjectRow).toHaveBeenCalledTimes(1);
  });

  it('accepts an archive status change', async () => {
    db.updateProjectRow.mockResolvedValue(draftProject({ status: 'archived' }));

    const response = await PATCH(
      idRequest(PROJECT_ID, 'PATCH', { status: 'archived' }),
      idParams(PROJECT_ID),
    );

    expect(response.status).toBe(200);
    expect(db.updateProjectRow).toHaveBeenCalledWith(expect.anything(), PROJECT_ID, {
      status: 'archived',
    });
  });

  it('rejects worker-owned statuses before any read happens', async () => {
    const response = await PATCH(
      idRequest(PROJECT_ID, 'PATCH', { status: 'generating' }),
      idParams(PROJECT_ID),
    );

    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ code: 'validation_error' });
    expect(db.getProjectRow).not.toHaveBeenCalled();
    expect(db.updateProjectRow).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/v1/projects/[id]', () => {
  it('answers 409 while a job is still active', async () => {
    db.hasActiveJob.mockResolvedValue(true);

    const response = await DELETE(idRequest(PROJECT_ID, 'DELETE'), idParams(PROJECT_ID));

    expect(response.status).toBe(409);
    expect(await bodyOf(response)).toEqual({
      error: { code: 'conflict', message: 'project has an active job — cancel it before deleting' },
    });
    expect(db.deleteProjectRow).not.toHaveBeenCalled();
  });

  it('answers 204 with no body', async () => {
    const response = await DELETE(idRequest(PROJECT_ID, 'DELETE'), idParams(PROJECT_ID));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('answers 404 when nothing was deleted', async () => {
    db.deleteProjectRow.mockResolvedValue(false);

    const response = await DELETE(idRequest(PROJECT_ID, 'DELETE'), idParams(PROJECT_ID));

    expect(response.status).toBe(404);
    expect(await bodyOf(response)).toEqual({
      error: { code: 'not_found', message: 'project not found' },
    });
  });
});

describe('GET /api/v1/providers', () => {
  it('reports the mock provider without echoing configuration', async () => {
    process.env.SCRIPTWRITER_PROVIDER = 'mock';

    const response = await providersGET(providersRequest());

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({
      data: { providers: { scriptwriter: { id: 'mock', isMock: true, ready: true } } },
    });
  });
});

describe('unauthenticated callers', () => {
  beforeEach(() => {
    harness.user = null;
  });

  it('POST /api/v1/projects answers 401', async () => {
    expect((await POST(createRequest(CREATE_BODY))).status).toBe(401);
    expect(db.getPrimaryWorkspaceId).not.toHaveBeenCalled();
  });

  it('GET /api/v1/projects answers 401', async () => {
    expect((await listGET(listRequest())).status).toBe(401);
    expect(db.getPrimaryWorkspaceId).not.toHaveBeenCalled();
  });

  it('GET /api/v1/projects/[id] answers 401', async () => {
    expect((await getProjectGET(idRequest(PROJECT_ID), idParams(PROJECT_ID))).status).toBe(401);
    expect(db.getProjectRow).not.toHaveBeenCalled();
  });

  it('PATCH /api/v1/projects/[id] answers 401', async () => {
    const response = await PATCH(
      idRequest(PROJECT_ID, 'PATCH', { title: 'renamed' }),
      idParams(PROJECT_ID),
    );
    expect(response.status).toBe(401);
    expect(db.getProjectRow).not.toHaveBeenCalled();
  });

  it('DELETE /api/v1/projects/[id] answers 401', async () => {
    expect((await DELETE(idRequest(PROJECT_ID, 'DELETE'), idParams(PROJECT_ID))).status).toBe(401);
    expect(db.hasActiveJob).not.toHaveBeenCalled();
  });

  it('GET /api/v1/providers answers 401', async () => {
    expect((await providersGET(providersRequest())).status).toBe(401);
  });

  it('checks the session before it even validates the body', async () => {
    // An unauthenticated caller must not learn anything about the request shape.
    const response = await POST(createRequest({ niche: 'definitely-not-a-niche' }));
    expect(response.status).toBe(401);
  });
});
