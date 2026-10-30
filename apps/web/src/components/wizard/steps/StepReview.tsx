import type { NicheTemplateSummary } from "@studio/niches";

import { FORMATS, SummaryRow, type WizardState } from "../shared";

// Step 4 — "Review". Presentational: every choice reads back from the shared
// WizardState, so this step can never disagree with what the earlier steps
// collected. The band hint comes from the CURRENT template + aspect — the
// validators in ../shared guarantee the duration is inside it by the time
// this step renders.

interface StepReviewProps {
  template: NicheTemplateSummary;
  state: WizardState;
  disabled: boolean;
  onPatch: (patch: Partial<WizardState>) => void;
}

export default function StepReview({ template, state, disabled, onPatch }: StepReviewProps) {
  const band = template.durationBands[state.aspectRatio];

  return (
    <section className="mt-6 space-y-6">
      <dl className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900 text-sm">
        <SummaryRow label="Niche" value={template.label} />
        <SummaryRow label="Topic" value={state.topic.trim()} />
        <SummaryRow label="Title" value={state.title.trim() || "Auto-derived from the topic"} />
        <SummaryRow
          label="Format"
          value={FORMATS.find((format) => format.value === state.format)?.label ?? state.format}
        />
        <SummaryRow label="Aspect ratio" value={state.aspectRatio} />
        <SummaryRow
          label="Target duration"
          value={`${state.targetDurationSeconds}s (band ${band.minSeconds}–${band.maxSeconds}s)`}
        />
        <SummaryRow
          label="Visual style"
          value={
            template.visualStyles.find((style) => style.id === state.visualStyleId)?.label ??
            "Template default"
          }
        />
        <SummaryRow
          label="Music mood"
          value={
            template.musicMoods.find((mood) => mood.id === state.musicMoodId)?.label ??
            "Template default"
          }
        />
        <SummaryRow label="Captions" value={`Template default (${template.captionStyleId})`} />
        <SummaryRow label="Instructions" value={state.instructions.trim() || "None"} />
      </dl>

      <label className="flex items-start gap-2 text-sm" htmlFor="wizard-auto-generate">
        <input
          id="wizard-auto-generate"
          type="checkbox"
          checked={state.autoGenerate}
          disabled={disabled}
          onChange={(event) => onPatch({ autoGenerate: event.target.checked })}
          className="mt-0.5 accent-neutral-200"
        />
        <span>
          Generate the script now
          <span className="mt-0.5 block text-xs text-neutral-500">
            Checked, a script generation job is queued the moment the project is created.
            Unchecked, the project starts as an empty draft.
          </span>
        </span>
      </label>
    </section>
  );
}
