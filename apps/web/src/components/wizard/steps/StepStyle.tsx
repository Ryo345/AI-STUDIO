import { INSTRUCTIONS_MAX } from "@studio/domain";
import type { NicheTemplateSummary } from "@studio/niches";

import { INPUT_CLASSES, type WizardState } from "../shared";

// Step 3 — "Style". Presentational: state and the niche-switch reset semantics
// live in WizardForm. Caption style stays display-only in M4 — the template
// default is authoritative, and config.captionStyleId is only sent when
// actually chosen, which this step never offers.

interface StepStyleProps {
  template: NicheTemplateSummary;
  state: WizardState;
  disabled: boolean;
  onPatch: (patch: Partial<WizardState>) => void;
}

export default function StepStyle({ template, state, disabled, onPatch }: StepStyleProps) {
  return (
    <section className="mt-6 space-y-6">
      <label className="block text-sm" htmlFor="wizard-visual-style">
        Visual style <span className="font-normal text-neutral-500">(optional)</span>
        <select
          id="wizard-visual-style"
          disabled={disabled}
          className={`mt-1 ${INPUT_CLASSES}`}
          value={state.visualStyleId}
          onChange={(event) => onPatch({ visualStyleId: event.target.value })}
        >
          <option value="">Template default</option>
          {template.visualStyles.map((style) => (
            <option key={style.id} value={style.id}>
              {style.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm" htmlFor="wizard-music-mood">
        Music mood <span className="font-normal text-neutral-500">(optional)</span>
        <select
          id="wizard-music-mood"
          disabled={disabled}
          className={`mt-1 ${INPUT_CLASSES}`}
          value={state.musicMoodId}
          onChange={(event) => onPatch({ musicMoodId: event.target.value })}
        >
          <option value="">Template default</option>
          {template.musicMoods.map((mood) => (
            <option key={mood.id} value={mood.id}>
              {mood.label}
            </option>
          ))}
        </select>
      </label>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm">
        <p className="font-medium text-neutral-200">Caption style</p>
        <p className="mt-1 text-xs text-neutral-400">
          Fixed to the {template.label} template default ({template.captionStyleId}) in this
          version.
        </p>
      </div>

      <label className="block text-sm" htmlFor="wizard-instructions">
        Instructions <span className="font-normal text-neutral-500">(optional)</span>
        <textarea
          id="wizard-instructions"
          maxLength={INSTRUCTIONS_MAX}
          rows={4}
          disabled={disabled}
          className={`mt-1 ${INPUT_CLASSES}`}
          value={state.instructions}
          onChange={(event) => onPatch({ instructions: event.target.value })}
        />
        <span className="mt-1 flex items-center justify-between text-xs text-neutral-500">
          <span>Tone, must-include beats, things to avoid.</span>
          <span>
            {state.instructions.length}/{INSTRUCTIONS_MAX}
          </span>
        </span>
      </label>
    </section>
  );
}
