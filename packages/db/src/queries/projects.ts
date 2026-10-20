import type { ProjectDTO, ProjectStatus } from '@studio/domain';

import type { StudioDbClient } from '../clients.js';
import { mapProjectRow, type DbRow } from '../mappers.js';

// Every function takes the CALLER's client: the web passes a user-session
// client (RLS scopes rows to that user's workspaces), the worker passes the
// service client. No function grants access by itself — that is deliberate.

export interface ListProjectsQuery {
  limit: number;
  offset: number;
  status?: ProjectStatus;
}

export async function listProjects(
  client: StudioDbClient,
  workspaceId: string,
  query: ListProjectsQuery,
): Promise<ProjectDTO[]> {
  let request = client
    .from('projects')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);
  if (query.status) request = request.eq('status', query.status);

  const { data, error } = await request;
  if (error) throw new Error(`listProjects failed: ${error.message}`);
  return (data ?? []).map((row) => mapProjectRow(row as DbRow));
}

export async function getProjectRow(
  client: StudioDbClient,
  projectId: string,
): Promise<ProjectDTO | null> {
  const { data, error } = await client
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(`getProjectRow failed: ${error.message}`);
  return data ? mapProjectRow(data as DbRow) : null;
}

export interface CreateProjectRow {
  workspaceId: string;
  createdBy: string | null;
  title: string;
  nicheKey: string;
  topic: string;
  config: Record<string, unknown>;
}

export async function createProjectRow(
  client: StudioDbClient,
  input: CreateProjectRow,
): Promise<ProjectDTO> {
  const { data, error } = await client
    .from('projects')
    .insert({
      workspace_id: input.workspaceId,
      created_by: input.createdBy,
      title: input.title,
      niche_key: input.nicheKey,
      topic: input.topic,
      config: input.config,
      status: 'draft',
    })
    .select('*')
    .single();
  if (error) throw new Error(`createProjectRow failed: ${error.message}`);
  return mapProjectRow(data as DbRow);
}

/**
 * Closed patch surface, mirroring ScenePatch. `status` is expressible
 * because the enqueue route legitimately flips draft → generating on the
 * web tier — every other status transition flows through the RPCs.
 * `workspace_id`, `current_script_version_id`, and audit columns are
 * deliberately unreachable, so a caller spreading request leftovers
 * cannot smuggle them in.
 */
export interface ProjectPatch {
  title?: string;
  nicheKey?: string;
  topic?: string;
  config?: Record<string, unknown>;
  status?: ProjectStatus;
}

/** Patch a project's user-editable fields; null when RLS hid it or the id is wrong. */
export async function updateProjectRow(
  client: StudioDbClient,
  projectId: string,
  patch: ProjectPatch,
): Promise<ProjectDTO | null> {
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update['title'] = patch.title;
  if (patch.nicheKey !== undefined) update['niche_key'] = patch.nicheKey;
  if (patch.topic !== undefined) update['topic'] = patch.topic;
  if (patch.config !== undefined) update['config'] = patch.config;
  if (patch.status !== undefined) update['status'] = patch.status;

  const { data, error } = await client
    .from('projects')
    .update(update)
    .eq('id', projectId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`updateProjectRow failed: ${error.message}`);
  return data ? mapProjectRow(data as DbRow) : null;
}

/** Deletes a project; false when RLS said no or it does not exist. */
export async function deleteProjectRow(client: StudioDbClient, projectId: string): Promise<boolean> {
  const { data, error } = await client
    .from('projects')
    .delete()
    .eq('id', projectId)
    .select('id');
  if (error) throw new Error(`deleteProjectRow failed: ${error.message}`);
  return (data ?? []).length > 0;
}
