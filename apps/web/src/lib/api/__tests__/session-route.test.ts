import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The AUTHENTICATED half of GET /api/v1/session.
//
// The 401 side of the guard is covered by the live dev-server probes (no
// cookie → 401; a forged JWT cookie → 401, proving the cookie is never
// trusted on its own). The 200/403/400 side needs a signed-in caller, which
// a unit test cannot mint — but it does not need to: the route's decisions
// are made entirely by two collaborators, and both are stubbed here:
//
//   * createSupabaseServerClient() → auth.getUser()  (who the caller is)
//   * supabase.rpc('has_workspace_role', …)          (what they may see)
//
// Stubbing the client rather than the auth server keeps this suite
// credential-free and deterministic, while still exercising the real route
// handler, the real guard, and the real error envelope.

interface RpcCall {
  fn: string;
  args: unknown;
}

const harness = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  userError: null as { message: string } | null,
  rpcData: undefined as unknown,
  rpcError: null as { message: string } | null,
  rpcCalls: [] as { fn: string; args: unknown }[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: harness.user },
        error: harness.userError,
      }),
    },
    rpc: async (fn: string, args: unknown) => {
      harness.rpcCalls.push({ fn, args });
      return { data: harness.rpcData, error: harness.rpcError };
    },
  }),
}));

const { GET } = await import('../../../app/api/v1/session/route.js');

const AUTHED_USER = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' };
const MEMBER_WORKSPACE = '22222222-2222-4222-8222-222222222222';

function request(query = ''): Request {
  return new Request(`http://localhost/api/v1/session${query}`);
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  harness.user = { ...AUTHED_USER };
  harness.userError = null;
  harness.rpcData = true;
  harness.rpcError = null;
  harness.rpcCalls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/v1/session — authenticated', () => {
  it('returns the caller identity for a signed-in request', async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({
      data: { user: { id: AUTHED_USER.id, email: AUTHED_USER.email } },
    });
  });

  it('never queries membership when no workspaceId is supplied', async () => {
    await GET(request());

    // The workspace check is opt-in: without a workspaceId there is nothing
    // to authorize, and the RPC must not be called.
    expect(harness.rpcCalls).toEqual([]);
  });

  it('returns the workspace when the caller holds the required role', async () => {
    const response = await GET(request(`?workspaceId=${MEMBER_WORKSPACE}`));

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({
      data: {
        user: { id: AUTHED_USER.id, email: AUTHED_USER.email },
        workspace: { id: MEMBER_WORKSPACE },
      },
    });
  });

  it('checks membership through has_workspace_role on the caller session', async () => {
    await GET(request(`?workspaceId=${MEMBER_WORKSPACE}`));

    expect(harness.rpcCalls).toEqual([
      {
        fn: 'has_workspace_role',
        args: { p_workspace_id: MEMBER_WORKSPACE, p_min_role: 'viewer' },
      },
    ]);
  });

  it('answers 403 when the caller is not a member of the workspace', async () => {
    harness.rpcData = false;

    const response = await GET(request(`?workspaceId=${MEMBER_WORKSPACE}`));

    expect(response.status).toBe(403);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ code: 'forbidden' });
    // A 403 must not leak whether the workspace exists — the message is
    // identical for "no such workspace" and "not a member".
    expect(JSON.stringify(body)).not.toContain(MEMBER_WORKSPACE);
  });

  it('fails closed with 500 when the membership check itself errors', async () => {
    // An RPC failure must never read as "allowed" — and must never leak the
    // database message to the caller.
    harness.rpcError = { message: 'relation "workspace_members" does not exist' };
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(request(`?workspaceId=${MEMBER_WORKSPACE}`));

    expect(response.status).toBe(500);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ code: 'internal_error' });
    expect(JSON.stringify(body)).not.toContain('does not exist');
  });

  it('answers 400 for a malformed workspaceId once the caller is authenticated', async () => {
    const response = await GET(request('?workspaceId=not-a-uuid'));

    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ code: 'validation_error' });
    // The submitted value must not be echoed back.
    expect(JSON.stringify(body)).not.toContain('not-a-uuid');
  });
});

describe('GET /api/v1/session — unauthenticated', () => {
  it('answers 401 when there is no session', async () => {
    harness.user = null;

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await bodyOf(response)).toEqual({
      error: { code: 'unauthorized', message: 'authentication required' },
    });
  });

  it('answers 401 when session revalidation fails', async () => {
    // auth.getUser() revalidates the JWT against the auth server. A rejected
    // token is an error, not an anonymous-but-valid session.
    harness.user = null;
    harness.userError = { message: 'invalid JWT' };

    const response = await GET(request());

    expect(response.status).toBe(401);
  });

  it('checks the session before it validates the query', async () => {
    // Ordering matters: an unauthenticated caller must not learn anything
    // about the request shape, and must never reach the database.
    harness.user = null;

    const response = await GET(request('?workspaceId=not-a-uuid'));

    expect(response.status).toBe(401);
    expect(harness.rpcCalls).toEqual([]);
  });

  it('answers 401 even for a workspace the caller would be allowed to see', async () => {
    harness.user = null;

    const response = await GET(request(`?workspaceId=${MEMBER_WORKSPACE}`));

    expect(response.status).toBe(401);
    expect(harness.rpcCalls).toEqual([]);
  });
});
