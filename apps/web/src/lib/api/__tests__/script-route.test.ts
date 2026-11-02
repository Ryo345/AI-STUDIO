import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiErrorEnvelopeSchema } from '@studio/domain';

// GET /projects/:id/script + PATCH /projects/:id/scenes/:sceneId through
// their real handlers, the real guard, and the real error envelope
// (withApiHandler converts thrown ApiErrors into responses — assertions
// check status + envelope, never a rejection). The Supabase session client
// and the @studio/db data layer are stubbed (same credential-free pattern
// as projects-route.test.ts); RLS semantics are approximated by the stubs —
// "hidden row" = null return, exactly what a user-scoped client sees.
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
  getProjectRow: vi.fn(),
  getProjectScript: vi.fn(),
  listScenes: vi.fn(),
  patchSceneRow: vi.fn(),
}));

vi.mock('@studio/db', () => db);

const { GET } = await import('../../../app/api/v1/projects/[id]/script/route.js');
const { PATCH } = await import(
  '../../../app/api/v1/projects/[id]/scenes/[sceneId]/route.js'
);

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const SCENE_ID = '45555555-5555-4555-8555-555555555555';
const VERSION_ID = '56666666-6666-4666-8666-666666666666';

const PROVENANCE = {
  providerId: 'nvidia-nim',
  model: 'meta/llama-3.1-70b-instruct',
  isMock: false,
  seed: 'seed-1',
  latencyMs: 1200,
};

const VERSION = {
  id: VERSION_ID,
  projectId: PROJECT_ID,
  versionNumber: 1,
  provenance: PROVENANCE,
  createdAt: '2026-10-31T20:00:00Z',
};

const SCENE = {
  id: SCENE_ID,
  projectId: PROJECT_ID,
  position: 0,
  originScriptVersionId: VERSION_ID,
  narration: 'Near a black hole, seconds stretch into years.',
  visualDescription: 'A slowly rotating accretion disk.',
  onScreenText: null,
  durationMs: 4000,
  soundCues: [],
  createdAt: '2026-10-31T20:00:00Z',
  updatedAt: '2026-10-31T20:00:00Z',
};

function routeContext(id: string): { params: Promise<{ id: string }> };
function routeContext(id: string, sceneId: string): { params: Promise<{ id: string; sceneId: string }> };
function routeContext(id: string, sceneId?: string) {
  return {
    params: Promise.resolve(sceneId === undefined ? { id } : { id, sceneId }),
  };
}

beforeEach(() => {
  harness.user = { id: USER_ID, email: 'owner@example.com' };
  harness.userError = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/v1/projects/:id/script', () => {
  it('returns version + scenes for a reachable project', async () => {
    db.getProjectRow.mockResolvedValue({ id: PROJECT_ID });
    db.getProjectScript.mockResolvedValue({ version: VERSION, scenes: [SCENE] });

    const response = await GET(new Request('http://x'), routeContext(PROJECT_ID));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { version: { id: string; versionNumber: number }; scenes: unknown[] };
    };
    expect(body.data.version).toMatchObject({ id: VERSION_ID, versionNumber: 1 });
    expect(body.data.scenes).toHaveLength(1);
  });

  it('answers { version: null, scenes: [] } for a project with no script yet', async () => {
    db.getProjectRow.mockResolvedValue({ id: PROJECT_ID });
    db.getProjectScript.mockResolvedValue({ version: null, scenes: [] });

    const response = await GET(new Request('http://x'), routeContext(PROJECT_ID));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { version: unknown; scenes: unknown[] };
    };
    expect(body.data.version).toBeNull();
    expect(body.data.scenes).toEqual([]);
  });

  it('404s a project outside the caller\'s reach (no existence leak)', async () => {
    db.getProjectRow.mockResolvedValue(null);

    const response = await GET(new Request('http://x'), routeContext(PROJECT_ID));
    expect(response.status).toBe(404);
    const body = ApiErrorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe('not_found');
  });

  it('401s without a session', async () => {
    harness.user = null;
    const response = await GET(new Request('http://x'), routeContext(PROJECT_ID));
    expect(response.status).toBe(401);
    const body = ApiErrorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe('unauthorized');
  });

  it('400s a malformed project id before any database round-trip', async () => {
    const response = await GET(new Request('http://x'), routeContext('not-a-uuid'));
    expect(response.status).toBe(400);
    expect(db.getProjectRow).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/v1/projects/:id/scenes/:sceneId', () => {
  it('patches a scene that belongs to the project', async () => {
    db.getProjectRow.mockResolvedValue({ id: PROJECT_ID });
    db.listScenes.mockResolvedValue([SCENE]);
    db.patchSceneRow.mockResolvedValue({ ...SCENE, narration: 'Edited.' });

    const request = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ narration: 'Edited.' }),
    });
    const response = await PATCH(request, routeContext(PROJECT_ID, SCENE_ID));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { scene: { narration: string } } };
    expect(body.data.scene.narration).toBe('Edited.');
    expect(db.patchSceneRow).toHaveBeenCalledWith(expect.anything(), SCENE_ID, {
      narration: 'Edited.',
    });
  });

  it('404s a scene id from a different project (cross-project write is never implied by the URL)', async () => {
    db.getProjectRow.mockResolvedValue({ id: PROJECT_ID });
    // A scene of THIS project with a different id — the requested sceneId
    // matches none of them, which is exactly the foreign-scene case.
    db.listScenes.mockResolvedValue([{ ...SCENE, id: '47777777-7777-4777-8777-777777777777' }]);

    const request = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ narration: 'Edited.' }),
    });
    const response = await PATCH(request, routeContext(PROJECT_ID, SCENE_ID));
    expect(response.status).toBe(404);
    expect(db.patchSceneRow).not.toHaveBeenCalled();
  });

  it('404s when the project itself is hidden', async () => {
    db.getProjectRow.mockResolvedValue(null);

    const request = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ narration: 'Edited.' }),
    });
    const response = await PATCH(request, routeContext(PROJECT_ID, SCENE_ID));
    expect(response.status).toBe(404);
    expect(db.listScenes).not.toHaveBeenCalled();
  });

  it('400s an empty patch (schema requires at least one field)', async () => {
    db.getProjectRow.mockResolvedValue({ id: PROJECT_ID });

    const request = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({}),
    });
    const response = await PATCH(request, routeContext(PROJECT_ID, SCENE_ID));
    expect(response.status).toBe(400);
    expect(db.patchSceneRow).not.toHaveBeenCalled();
  });

  it('404s when the scene vanishes between lookup and write (regenerate race)', async () => {
    db.getProjectRow.mockResolvedValue({ id: PROJECT_ID });
    db.listScenes.mockResolvedValue([SCENE]);
    db.patchSceneRow.mockResolvedValue(null);

    const request = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ durationMs: 5000 }),
    });
    const response = await PATCH(request, routeContext(PROJECT_ID, SCENE_ID));
    expect(response.status).toBe(404);
  });
});
