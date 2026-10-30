import { PROJECT_TITLE_MAX, TOPIC_MAX } from "@studio/domain";
import type { AspectRatio, NicheKey, ScriptFormat } from "@studio/domain";
import type { NicheTemplateSummary } from "@studio/niches";

// Shared vocabulary for the project wizard: the single WizardState shape, the
// per-field error typing, the step validators, and the class strings every
// step reuses. One module on purpose — the four step components stay purely
// presentational (state slice + callbacks in, JSX out) and none of them owns
// validation logic or styling decisions.

export const TOPIC_MIN = 3; // mirrors createProjectSchema's trim().min(3)

export const FORMATS: readonly { value: ScriptFormat; label: string; hint: string }[] = [
  { value: "narrative", label: "Narrative", hint: "One continuous story arc." },
  { value: "listicle", label: "Listicle", hint: "Numbered beats building to a payoff." },
  { value: "explainer", label: "Explainer", hint: "Concept, how it works, takeaway." },
];

export const ASPECTS: readonly { value: AspectRatio; label: string }[] = [
  { value: "9:16", label: "9:16 vertical" },
  { value: "16:9", label: "16:9 landscape" },
];

export const PRIMARY_BUTTON =
  "rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:opacity-60";
export const SECONDARY_BUTTON =
  "rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:border-neutral-500 disabled:opacity-60";
export const INPUT_CLASSES =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none";
export const FIELD_ERROR_CLASSES = "mt-1 block text-xs text-red-400";

export interface WizardState {
  nicheKey: NicheKey;
  topic: string;
  title: string;
  format: ScriptFormat;
  aspectRatio: AspectRatio;
  targetDurationSeconds: number;
  /** "" = leave unset; the optional style ids are sent only when chosen. */
  visualStyleId: string;
  musicMoodId: string;
  instructions: string;
  autoGenerate: boolean;
}

/** Field-level errors for the step currently on screen. */
export type StepErrors = Partial<
  Record<"topic" | "title" | "targetDurationSeconds", string>
>;

export function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Placeholder for the optional title input, derived from the live topic. */
export function deriveTitlePlaceholder(topic: string): string {
  // Collapse whitespace so multi-line topics read as one title line, then cut
  // at a word boundary so the preview never ends mid-word.
  const collapsed = topic.trim().replace(/\s+/g, " ");
  if (!collapsed) return "";
  if (collapsed.length <= PROJECT_TITLE_MAX) return collapsed;
  const cut = collapsed.slice(0, PROJECT_TITLE_MAX - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function step1Errors(state: WizardState): StepErrors {
  const errors: StepErrors = {};
  const topic = state.topic.trim();
  if (topic.length < TOPIC_MIN) {
    errors.topic = `Topic must be at least ${TOPIC_MIN} characters.`;
  } else if (topic.length > TOPIC_MAX) {
    errors.topic = `Topic must be at most ${TOPIC_MAX} characters.`;
  }
  if (state.title.trim().length > PROJECT_TITLE_MAX) {
    errors.title = `Title must be at most ${PROJECT_TITLE_MAX} characters.`;
  }
  return errors;
}

export function step2Errors(state: WizardState, template: NicheTemplateSummary): StepErrors {
  const errors: StepErrors = {};
  const band = template.durationBands[state.aspectRatio];
  const duration = state.targetDurationSeconds;
  if (!Number.isInteger(duration) || duration < band.minSeconds || duration > band.maxSeconds) {
    errors.targetDurationSeconds = `Target duration must be between ${band.minSeconds} and ${band.maxSeconds} seconds for ${template.label} in ${state.aspectRatio}.`;
  }
  return errors;
}

// One read-only row of the review list. Lives here because every step draws
// from the same class vocabulary and it has no state of its own.
export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 px-4 py-2.5">
      <dt className="w-32 shrink-0 text-neutral-500">{label}</dt>
      <dd className="min-w-0 break-words text-neutral-200">{value}</dd>
    </div>
  );
}
