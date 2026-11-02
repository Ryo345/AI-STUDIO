import {
  JobDTOSchema,
  type JobDTO,
  JobEventDTOSchema,
  type JobEventDTO,
  ModelAssignmentDTOSchema,
  type ModelAssignmentDTO,
  ProjectDTOSchema,
  type ProjectDTO,
  ProviderConnectionDTOSchema,
  type ProviderConnectionDTO,
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

/**
 * LIST-endpoint resilience: map every row, skipping (with a loud warning)
 * any row that fails DTO validation instead of throwing — one junk row
// (e.g. a hand-written config={"x":1} inserted via PostgREST) must not
 * brick a whole workspace listing forever. Deliberately NOT used on
 * single-row paths (getProjectRow, getProjectScript, patch/create returns):
 * there, silent row-hiding would be worse than a loud 500, so those keep
 * throwing RowMappingError.
 */
export function mapRowsResilient<T>(
  table: string,
  mapRow: (row: DbRow) => T,
  rows: DbRow[],
): T[] {
  const out: T[] = [];
  for (const row of rows) {
    try {
      out.push(mapRow(row));
    } catch (cause) {
      if (!(cause instanceof RowMappingError)) throw cause;
      console.warn(
        `[db] skipping one ${table} row (id=${String(row['id'] ?? 'unknown')}): ${describeFailure(cause.cause)}`,
      );
    }
  }
  return out;
}

/**
 * Describes a validation failure by PATH AND CODE ONLY.
 *
 * zod's issue objects carry the offending `input`, and ZodError.message is
 * the JSON of the whole issue array — logging it verbatim would copy user
 * text (a topic, a title, a jsonb config) into the server log. The row id
 * plus the failing paths are enough to find the offending row.
 */
function describeFailure(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null && 'issues' in cause) {
    const issues = (cause as { issues: unknown }).issues;
    if (Array.isArray(issues)) {
      const described = issues.map((issue) => {
        const path = Array.isArray((issue as { path?: unknown }).path)
          ? (issue as { path: unknown[] }).path.join('.')
          : '';
        const code =
          typeof (issue as { code?: unknown }).code === 'string'
            ? (issue as { code: string }).code
            : 'invalid';
        return path ? `${path}: ${code}` : code;
      });
      if (described.length > 0) return described.join('; ');
    }
  }
  return cause instanceof Error ? cause.message : 'unknown validation failure';
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

// ── BYOK (0006) ──────────────────────────────────────────────────────────
// mapProviderConnectionRow NEVER maps a `credential` column: rows come from
// column-restricted selects, and the DTO schema would reject the extra key
// anyway. Plaintext keys exist only inside encrypt/decrypt call frames.

export function mapProviderConnectionRow(row: DbRow): ProviderConnectionDTO {
  return map('provider_connections', (v) => ProviderConnectionDTOSchema.parse(v), {
    id: row['id'],
    workspaceId: row['workspace_id'],
    createdBy: row['created_by'],
    providerId: row['provider_id'],
    baseUrl: row['base_url'],
    keyHint: row['key_hint'],
    status: row['status'],
    lastTestedAt: row['last_tested_at'],
    lastTestError: row['last_test_error'],
    createdAt: row['created_at'],
    updatedAt: row['updated_at'],
  });
}

export function mapModelAssignmentRow(row: DbRow): ModelAssignmentDTO {
  return map('model_assignments', (v) => ModelAssignmentDTOSchema.parse(v), {
    id: row['id'],
    workspaceId: row['workspace_id'],
    task: row['task'],
    providerId: row['provider_id'],
    model: row['model'],
    settings: row['settings'],
    createdAt: row['created_at'],
    updatedAt: row['updated_at'],
  });
}
