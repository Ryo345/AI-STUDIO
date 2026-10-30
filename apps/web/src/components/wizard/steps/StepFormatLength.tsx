import type { AspectRatio } from "@studio/domain";
import type { NicheTemplateSummary } from "@studio/niches";

import {
  ASPECTS,
  FIELD_ERROR_CLASSES,
  FORMATS,
  type StepErrors,
  type WizardState,
} from "../shared";

// Step 2 — "Format & length". Presentational: the clamp-on-change policy
// (niche switch, aspect switch, blur) lives in WizardForm; this component only
// reports raw input. Partial typing stays unclamped on purpose — see
// setDurationFromInput there.

interface StepFormatLengthProps {
  template: NicheTemplateSummary;
  state: WizardState;
  errors: StepErrors;
  disabled: boolean;
  onPatch: (patch: Partial<WizardState>) => void;
  onSelectAspect: (aspectRatio: AspectRatio) => void;
  onDurationInput: (raw: string) => void;
  onDurationBlur: () => void;
}

export default function StepFormatLength({
  template,
  state,
  errors,
  disabled,
  onPatch,
  onSelectAspect,
  onDurationInput,
  onDurationBlur,
}: StepFormatLengthProps) {
  const band = template.durationBands[state.aspectRatio];

  return (
    <section className="mt-6 space-y-6">
      <fieldset disabled={disabled}>
        <legend className="text-sm font-medium text-neutral-200">Format</legend>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {FORMATS.map((format) => (
            <label
              key={format.value}
              className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 transition-colors ${
                state.format === format.value
                  ? "border-neutral-300 bg-neutral-800/60"
                  : "border-neutral-800 bg-neutral-900 hover:border-neutral-600"
              }`}
            >
              <input
                type="radio"
                name="wizard-format"
                value={format.value}
                checked={state.format === format.value}
                onChange={() => onPatch({ format: format.value })}
                className="mt-0.5 accent-neutral-200"
              />
              <span>
                <span className="block text-sm font-medium text-neutral-100">{format.label}</span>
                <span className="mt-0.5 block text-xs text-neutral-400">{format.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend className="text-sm font-medium text-neutral-200">Aspect ratio</legend>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {ASPECTS.map((aspect) => (
            <label
              key={aspect.value}
              className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm transition-colors ${
                state.aspectRatio === aspect.value
                  ? "border-neutral-300 bg-neutral-800/60 text-neutral-100"
                  : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-600"
              }`}
            >
              <input
                type="radio"
                name="wizard-aspect"
                value={aspect.value}
                checked={state.aspectRatio === aspect.value}
                onChange={() => onSelectAspect(aspect.value)}
                className="accent-neutral-200"
              />
              {aspect.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="wizard-duration" className="block text-sm">
          Target duration
          <span className="ml-1 text-xs text-neutral-500">
            {band.minSeconds}–{band.maxSeconds}s band for {template.label} in {state.aspectRatio} ·
            ideal {band.idealSeconds}s
          </span>
        </label>
        <div className="mt-2 flex items-center gap-3">
          <input
            id="wizard-duration"
            type="range"
            min={band.minSeconds}
            max={band.maxSeconds}
            step={1}
            value={state.targetDurationSeconds}
            disabled={disabled}
            onChange={(event) => onPatch({ targetDurationSeconds: Number(event.target.value) })}
            className="w-full accent-neutral-200"
          />
          <input
            type="number"
            aria-label="Target duration in seconds"
            min={band.minSeconds}
            max={band.maxSeconds}
            step={1}
            value={state.targetDurationSeconds}
            disabled={disabled}
            aria-invalid={Boolean(errors.targetDurationSeconds) || undefined}
            aria-describedby={errors.targetDurationSeconds ? "wizard-duration-error" : undefined}
            onChange={(event) => onDurationInput(event.target.value)}
            onBlur={onDurationBlur}
            className="w-24 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Seconds of finished narration. The band comes from the selected niche and aspect ratio.
        </p>
        {errors.targetDurationSeconds ? (
          <p id="wizard-duration-error" className={FIELD_ERROR_CLASSES}>
            {errors.targetDurationSeconds}
          </p>
        ) : null}
      </div>
    </section>
  );
}
