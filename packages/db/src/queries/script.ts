import type { SceneDTO, ScriptVersionDTO } from '@studio/domain';

import type { StudioDbClient } from '../clients.js';
import { mapSceneRow, mapScriptVersionRow, type DbRow } from '../mappers.js';

// The script endpoint contract: a project that has never had a script (or
// whose version row vanished) yields { version: null, scenes: [] } — the
// client branches on ONE shape, never on a 404.

export interface ProjectScript {
  version: ScriptVersionDTO | null;
  scenes: SceneDTO[];
}

export async function getProjectScript(
  client: StudioDbClient,
  projectId: string,
): Promise<ProjectScript> {
  const { data: project, error: projectError } = await client
    .from('projects')
    .select('current_script_version_id')
    .eq('id', projectId)
    .maybeSingle();

  if (projectError) throw new Error(`getProjectScript(project) failed: ${projectError.message}`);

  const versionId = (project as DbRow | null)?.['current_script_version_id'];
  if (!versionId) return { version: null, scenes: [] };

  const { data: version, error: versionError } = await client
    .from('script_versions')
    .select('*')
    .eq('id', String(versionId))
    .maybeSingle();

  if (versionError) throw new Error(`getProjectScript(version) failed: ${versionError.message}`);
  if (!version) return { version: null, scenes: [] };

  const { data: scenes, error: scenesError } = await client
    .from('scenes')
    .select('*')
    .eq('project_id', projectId)
    .order('position', { ascending: true });

  if (scenesError) throw new Error(`getProjectScript(scenes) failed: ${scenesError.message}`);

  return {
    version: mapScriptVersionRow(version as DbRow),
    scenes: ((scenes ?? []) as DbRow[]).map(mapSceneRow),
  };
}

export async function listScenes(
  client: StudioDbClient,
  projectId: string,
): Promise<SceneDTO[]> {
  const { data, error } = await client
    .from('scenes')
    .select('*')
    .eq('project_id', projectId)
    .order('position', { ascending: true });
  if (error) throw new Error(`listScenes failed: ${error.message}`);
  return ((data ?? []) as DbRow[]).map(mapSceneRow);
}

export interface ScenePatch {
  narration?: string;
  visualDescription?: string;
  onScreenText?: string | null;
  durationMs?: number;
}

/** Patch one scene; null when RLS hid it or the id is wrong. */
export async function patchSceneRow(
  client: StudioDbClient,
  sceneId: string,
  patch: ScenePatch,
): Promise<SceneDTO | null> {
  const update: Record<string, unknown> = {};
  if (patch.narration !== undefined) update['narration'] = patch.narration;
  if (patch.visualDescription !== undefined) update['visual_description'] = patch.visualDescription;
  if (patch.onScreenText !== undefined) update['on_screen_text'] = patch.onScreenText;
  if (patch.durationMs !== undefined) update['duration_ms'] = patch.durationMs;

  const { data, error } = await client
    .from('scenes')
    .update(update)
    .eq('id', sceneId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`patchSceneRow failed: ${error.message}`);
  return data ? mapSceneRow(data as DbRow) : null;
}
