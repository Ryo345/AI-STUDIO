// Provider adapter contracts. Every scriptwriter adapter — mock, anthropic,
// openai-compatible — implements the same interface, so the worker's
// processor is provider-blind. All provider selection is env-driven
// server-side; no secret value ever leaves this package.

import type {
  GeneratedScript,
  ProjectConfig,
  ScriptProvenance,
  ScriptwriterProviderId,
} from '@studio/domain';
import type { NicheTemplate } from '@studio/niches';

export const PROVIDERS_VERSION = '0.1.0';

/** Everything an adapter needs to write one script. No DB shapes — pure inputs. */
export interface ScriptwriterRequest {
  /** Job-scoped seed: same job → same mock output, reproducible retries. */
  jobId: string;
  topic: string;
  template: NicheTemplate;
  config: ProjectConfig;
  /** Explicit steering from the enqueue payload; config.instructions is merged in. */
  instructions?: string;
}

/** Runtime context handed to every generate call. */
export interface ScriptwriterContext {
  /** Aborted when cancel was requested or the lock was stolen — the adapter MUST stop promptly. */
  signal: AbortSignal;
  /** Structured progress logging (worker log + job stage marks). */
  log?: (message: string, detail?: Record<string, unknown>) => void;
}

export interface ScriptwriterResult {
  /** Already normalized through @studio/pipeline — persistable as-is. */
  script: GeneratedScript;
  provenance: ScriptProvenance;
}

export interface ScriptwriterAdapter {
  readonly id: ScriptwriterProviderId;
  /** Mock output must be badged MOCK on every surface; real output must not. */
  readonly isMock: boolean;
  generate(request: ScriptwriterRequest, ctx: ScriptwriterContext): Promise<ScriptwriterResult>;
}

/** A real provider selected without its credentials — boot fails loudly, never a silent fallback. */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

/**
 * A provider call that failed in a classified way. `retryable` flows into
 * job_failed: content-policy 400s and auth errors must not burn attempts,
 * timeouts and 5xx should.
 */
export class ProviderCallError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderCallError';
  }
}
