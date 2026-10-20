import {
  JobDTOSchema,
  type JobDTO,
  JobEventDTOSchema,
  type JobEventDTO,
  ProjectDTOSchema,
  type ProjectDTO,
  SceneDTOSchema,
  type SceneDTO,
  ScriptVersionDTOSchema,
  type ScriptVersionDTO,
} from '@studio/domain';

// supabase-js returns Postgres rows verbatim (snake_case columns, ISO-ish
// timestamp strings). Mappers rename to the API's camelCase DTOs and run
// each row through its zod DTO schema so a malformed row surfaces HERE,
// not as a corrupted response three layers away.

export type DbRow = Record<string, unknown>;

export class RowMappingError extends Error {
  constructor(table: string, cause: unknown) {
    super(`a ${table} row failed DTO validation — schema/code drift?`, { cause });
    this.name = 'RowMappingError';
  }
}

function map<T>(
  table: string,
  parse: (value: unknown) => T,
  value: unknown,
): T {
  try {
    return parse(value);
  } catch (cause) {
    throw new RowMappingError(table, cause);
  }
}

export function mapProjectRow(row: DbRow): ProjectDTO {
  return map('projects', (v) => ProjectDTOSchema.parse(v), {
    id: row['id'],
    workspaceId: row['workspace_id'],
    title: row['title'],
    niche: row['niche_key'],
    topic: row['topic'],
    config: row['config'],
    status: row['status'],
    createdAt: row['created_at'],
    updatedAt: row['updated_at'],
  });
}

export function mapScriptVersionRow(row: DbRow): ScriptVersionDTO {
  return map('script_versions', (v) => ScriptVersionDTOSchema.parse(v), {
    id: row['id'],
    projectId: row['project_id'],
    versionNumber: row['version_number'],
    provenance: row['provenance'],
    createdAt: row['created_at'],
  });
}

export function mapSceneRow(row: DbRow): SceneDTO {
  return map('scenes', (v) => SceneDTOSchema.parse(v), {
    id: row['id'],
    projectId: row['project_id'],
    position: row['position'],
    originScriptVersionId: row['origin_script_version_id'],
    narration: row['narration'],
    visualDescription: row['visual_description'],
    onScreenText: row['on_screen_text'],
    durationMs: row['duration_ms'],
    soundCues: row['sound_cues'],
    createdAt: row['created_at'],
    updatedAt: row['updated_at'],
  });
}

export function mapJobRow(row: DbRow): JobDTO {
  return map('jobs', (v) => JobDTOSchema.parse(v), {
    id: row['id'],
    workspaceId: row['workspace_id'],
    projectId: row['project_id'],
    type: row['type'],
    status: row['status'],
    attempt: row['attempt'],
    maxAttempts: row['max_attempts'],
    cancelRequested: row['cancel_requested'],
    error: row['error'],
    result: row['result'],
    createdAt: row['created_at'],
    startedAt: row['started_at'],
    finishedAt: row['finished_at'],
  });
}

export function mapJobEventRow(row: DbRow): JobEventDTO {
  return map('job_events', (v) => JobEventDTOSchema.parse(v), {
    id: row['id'],
    jobId: row['job_id'],
    kind: row['kind'],
    detail: row['detail'],
    at: row['at'],
  });
}
