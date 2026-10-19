// @studio/domain — zod schemas, inferred types, and enums.
// Single source of truth for every API contract and DB row shape.

export const DOMAIN_VERSION = '0.1.0';

// enums
export {
  AspectRatioSchema,
  type AspectRatio,
  ProjectStatusSchema,
  type ProjectStatus,
  NicheKeySchema,
  type NicheKey,
  ScriptFormatSchema,
  type ScriptFormat,
  WorkspaceRoleSchema,
  type WorkspaceRole,
  JobStatusSchema,
  type JobStatus,
  TERMINAL_JOB_STATUSES,
  JobTypeSchema,
  type JobType,
  ScriptwriterProviderIdSchema,
  type ScriptwriterProviderId,
  OnScreenTextStrategySchema,
  type OnScreenTextStrategy,
} from './enums.js';

// project
export {
  PROJECT_TITLE_MAX,
  TOPIC_MAX,
  INSTRUCTIONS_MAX,
  ProjectConfigSchema,
  type ProjectConfig,
  createProjectSchema,
  type CreateProjectInput,
  updateProjectSchema,
  type UpdateProjectInput,
  ProjectDTOSchema,
  type ProjectDTO,
} from './project.js';

// script
export {
  SoundCueSchema,
  type SoundCue,
  GeneratedSceneSchema,
  type GeneratedScene,
  GeneratedScriptSchema,
  type GeneratedScript,
  ScriptProvenanceSchema,
  type ScriptProvenance,
  ScriptVersionDTOSchema,
  type ScriptVersionDTO,
  SceneDTOSchema,
  type SceneDTO,
  patchSceneSchema,
  type PatchSceneInput,
  reorderScenesSchema,
  generateScriptSchema,
  type GenerateScriptInput,
} from './script.js';

// job
export {
  ScriptGeneratePayloadSchema,
  type ScriptGeneratePayload,
  ScriptGenerateResultSchema,
  type ScriptGenerateResult,
  JobErrorSchema,
  type JobError,
  JobDTOSchema,
  type JobDTO,
  JobEventDTOSchema,
  type JobEventDTO,
} from './job.js';

// usage
export {
  USAGE_OPERATIONS,
  type UsageOperation,
  UsageEventSchema,
  type UsageEvent,
  UsageReportRowSchema,
  type UsageReportRow,
  UsageReportDTOSchema,
  type UsageReportDTO,
} from './usage.js';

// api contracts
export {
  ApiErrorCodeSchema,
  type ApiErrorCode,
  API_ERROR_STATUS,
  ApiErrorEnvelopeSchema,
  type ApiErrorEnvelope,
  ApiError,
} from './api/error.js';

export {
  paginationQuerySchema,
  type PaginationQuery,
  projectListQuerySchema,
  projectJobsQuerySchema,
  usageQuerySchema,
} from './api/query.js';
