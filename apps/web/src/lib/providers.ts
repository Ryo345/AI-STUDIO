// Scriptwriter provider readiness, read from env — the single source of
// truth for GET /api/v1/providers and the dashboard's provider/MOCK badge.
//
// This is deliberately a pure env read, not a @studio/providers call: the
// adapter registry itself arrives with M5/M6 (resolveScriptwriter). Until
// then this module carries the same contract the adapters will implement
// (docs/env-vars.md is canonical for the variable names), so the /providers
// response and the UI badge never change shape when the real adapters land.
//
// No secret value ever crosses this boundary — readiness booleans and the
// NAME of a missing variable, never its contents.

export type ScriptwriterProviderId = "mock" | "anthropic" | "openai-compatible";

export interface ProviderStatus {
  id: ScriptwriterProviderId;
  /** Mock output must be badged MOCK on every surface; real output must not. */
  isMock: boolean;
  /** Whether the provider can actually serve a generation request right now. */
  ready: boolean;
  /** Why not ready — names the missing variable, never a secret value. */
  detail?: string;
}

export function getScriptwriterProviderStatus(): ProviderStatus {
  const selected = process.env.SCRIPTWRITER_PROVIDER?.trim().toLowerCase();

  if (selected === "anthropic") {
    return process.env.ANTHROPIC_API_KEY
      ? { id: "anthropic", isMock: false, ready: true }
      : {
          id: "anthropic",
          isMock: false,
          ready: false,
          detail: "ANTHROPIC_API_KEY missing",
        };
  }

  if (selected === "openai-compatible") {
    const missing = [
      ["OPENAI_COMPATIBLE_BASE_URL", process.env.OPENAI_COMPATIBLE_BASE_URL],
      ["OPENAI_COMPATIBLE_API_KEY", process.env.OPENAI_COMPATIBLE_API_KEY],
      ["OPENAI_COMPATIBLE_MODEL", process.env.OPENAI_COMPATIBLE_MODEL],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    return missing.length === 0
      ? { id: "openai-compatible", isMock: false, ready: true }
      : {
          id: "openai-compatible",
          isMock: false,
          ready: false,
          detail: `${missing.join(", ")} missing`,
        };
  }

  // Unset or unknown values fall back to mock — the documented default.
  // Never a silent fake: the response carries isMock:true so every surface
  // can (and must) badge it.
  return { id: "mock", isMock: true, ready: true };
}
