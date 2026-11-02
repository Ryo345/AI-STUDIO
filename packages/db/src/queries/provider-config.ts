// BYOK queries — provider_connections + model_assignments (0006).
//
// Two clients, two postures:
//   * user-session client: RLS-gated CRUD. The SELECT column list here is
//     also the DB-side column grant — the `credential` ciphertext is never
//     in a result set an end user can reach.
//   * service client (worker): direct reads, decryption happens in the
//     worker process only.

import { ApiError, type ModelAssignmentDTO, type ProviderConnectionDTO } from '@studio/domain';

import type { StudioDbClient } from '../clients.js';
import { mapModelAssignmentRow, mapProviderConnectionRow, type DbRow } from '../mappers.js';

const PG_UNIQUE_VIOLATION = '23505';

/** Columns safe to read in ANY user-context select — mirrors the 0006 column grant. */
const CONNECTION_SAFE_COLUMNS =
  'id, workspace_id, created_by, provider_id, base_url, key_hint, status, last_tested_at, last_test_error, created_at, updated_at';

// ── provider_connections (user-session client) ───────────────────────────

export async function listProviderConnections(
  client: StudioDbClient,
  workspaceId: string,
): Promise<ProviderConnectionDTO[]> {
  const { data, error } = await client
    .from('provider_connections')
    .select(CONNECTION_SAFE_COLUMNS)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listProviderConnections failed: ${error.message}`);
  return ((data ?? []) as DbRow[]).map(mapProviderConnectionRow);
}

export async function getProviderConnection(
  client: StudioDbClient,
  workspaceId: string,
  connectionId: string,
): Promise<ProviderConnectionDTO | null> {
  const { data, error } = await client
    .from('provider_connections')
    .select(CONNECTION_SAFE_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('id', connectionId)
    .maybeSingle();
  if (error) throw new Error(`getProviderConnection failed: ${error.message}`);
  return data ? mapProviderConnectionRow(data as DbRow) : null;
}

/**
 * Full row (including the ciphertext) with the SERVICE client — the worker's
 * per-job credential load. Returns the raw row; decryption is the caller's job.
 */
export async function getConnectionCredential(
  client: StudioDbClient,
  workspaceId: string,
  providerId: string,
): Promise<{ id: string; status: string; credential: string; keyHint: string; baseUrl: string | null } | null> {
  const { data, error } = await client
    .from('provider_connections')
    .select('id, status, credential, key_hint, base_url')
    .eq('workspace_id', workspaceId)
    .eq('provider_id', providerId)
    .maybeSingle();
  if (error) throw new Error(`getConnectionCredential failed: ${error.message}`);
  if (!data) return null;
  const row = data as DbRow;
  const baseUrl = row['base_url'];
  return {
    id: String(row['id']),
    status: String(row['status']),
    credential: String(row['credential']),
    keyHint: String(row['key_hint']),
    baseUrl: typeof baseUrl === 'string' && baseUrl.length > 0 ? baseUrl : null,
  };
}

export interface InsertProviderConnection {
  workspaceId: string;
  createdBy: string;
  providerId: string;
  /** Custom endpoint override; null = provider hosted default. */
  baseUrl: string | null;
  /** AES-256-GCM envelope from @studio/providers encryptSecret — never plaintext. */
  credential: string;
  keyHint: string;
}

/** Insert via the CALLER's client (RLS: editor + created_by pinned). 409 on duplicate provider. */
export async function insertProviderConnection(
  client: StudioDbClient,
  input: InsertProviderConnection,
): Promise<ProviderConnectionDTO> {
  const { data, error } = await client
    .from('provider_connections')
    .insert({
      workspace_id: input.workspaceId,
      created_by: input.createdBy,
      provider_id: input.providerId,
      base_url: input.baseUrl,
      credential: input.credential,
      key_hint: input.keyHint,
      status: 'untested',
    })
    .select(CONNECTION_SAFE_COLUMNS)
    .single();
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      throw new ApiError('unique_active_job', 'A connection for this provider already exists in this workspace');
    }
    if (error.code === '42501') {
      throw new ApiError('forbidden', 'editor role required to manage provider connections');
    }
    throw new Error(`insertProviderConnection failed: ${error.message}`);
  }
  return mapProviderConnectionRow(data as DbRow);
}

export interface UpdateProviderCredential {
  workspaceId: string;
  connectionId: string;
  credential: string;
  keyHint: string;
}

/** Replace the key: re-encrypt + reset test state. Caller must re-verify via the test endpoint. */
export async function updateProviderCredential(
  client: StudioDbClient,
  input: UpdateProviderCredential,
): Promise<ProviderConnectionDTO> {
  const { data, error } = await client
    .from('provider_connections')
    .update({
      credential: input.credential,
      key_hint: input.keyHint,
      status: 'untested',
      last_tested_at: null,
      last_test_error: null,
    })
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.connectionId)
    .select(CONNECTION_SAFE_COLUMNS)
    .single();
  if (error) {
    if (error.code === '42501') {
      throw new ApiError('forbidden', 'editor role required to manage provider connections');
    }
    throw new Error(`updateProviderCredential failed: ${error.message}`);
  }
  return mapProviderConnectionRow(data as DbRow);
}

export interface SetConnectionTestOutcome {
  workspaceId: string;
  connectionId: string;
  ok: boolean;
  testedAt: string;
  error?: { code: string; message: string } | null;
}

/** Persist a connection-test outcome (status flip + diagnostics for the UI). */
export async function setConnectionTestOutcome(
  client: StudioDbClient,
  input: SetConnectionTestOutcome,
): Promise<ProviderConnectionDTO> {
  const { data, error } = await client
    .from('provider_connections')
    .update({
      status: input.ok ? 'active' : 'failed',
      last_tested_at: input.testedAt,
      last_test_error: input.ok ? null : (input.error ?? { code: 'unknown', message: 'connection test failed' }),
    })
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.connectionId)
    .select(CONNECTION_SAFE_COLUMNS)
    .single();
  if (error) {
    if (error.code === '42501') {
      throw new ApiError('forbidden', 'editor role required to manage provider connections');
    }
    throw new Error(`setConnectionTestOutcome failed: ${error.message}`);
  }
  return mapProviderConnectionRow(data as DbRow);
}

export async function deleteProviderConnection(
  client: StudioDbClient,
  workspaceId: string,
  connectionId: string,
): Promise<void> {
  const { data, error } = await client
    .from('provider_connections')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', connectionId)
    .select('id')
    .single();
  if (error) {
    if (error.code === '42501') {
      throw new ApiError('forbidden', 'owner role required to delete provider connections');
    }
    throw new Error(`deleteProviderConnection failed: ${error.message}`);
  }
  if (!data) throw new ApiError('not_found', 'connection not found');
}

// ── model_assignments (user-session client) ──────────────────────────────

export async function listModelAssignments(
  client: StudioDbClient,
  workspaceId: string,
): Promise<ModelAssignmentDTO[]> {
  const { data, error } = await client
    .from('model_assignments')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('task', { ascending: true });
  if (error) throw new Error(`listModelAssignments failed: ${error.message}`);
  return ((data ?? []) as DbRow[]).map(mapModelAssignmentRow);
}

export interface UpsertModelAssignment {
  workspaceId: string;
  task: string;
  providerId: string;
  model: string;
  settings: Record<string, unknown>;
}

/** Upsert one (workspace, task) row — the router's write path. */
export async function upsertModelAssignment(
  client: StudioDbClient,
  input: UpsertModelAssignment,
): Promise<ModelAssignmentDTO> {
  const { data, error } = await client
    .from('model_assignments')
    .upsert(
      {
        workspace_id: input.workspaceId,
        task: input.task,
        provider_id: input.providerId,
        model: input.model,
        settings: input.settings,
      },
      { onConflict: 'workspace_id,task' },
    )
    .select('*')
    .single();
  if (error) {
    if (error.code === '42501') {
      throw new ApiError('forbidden', 'editor role required to change model assignments');
    }
    throw new Error(`upsertModelAssignment failed: ${error.message}`);
  }
  return mapModelAssignmentRow(data as DbRow);
}

export async function deleteModelAssignment(
  client: StudioDbClient,
  workspaceId: string,
  task: string,
): Promise<void> {
  const { data, error } = await client
    .from('model_assignments')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('task', task)
    .select('task')
    .single();
  if (error) {
    if (error.code === '42501') {
      throw new ApiError('forbidden', 'owner role required to delete model assignments');
    }
    throw new Error(`deleteModelAssignment failed: ${error.message}`);
  }
  if (!data) throw new ApiError('not_found', 'assignment not found');
}
