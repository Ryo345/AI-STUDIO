import { PROJECT_TITLE_MAX, TOPIC_MAX, type NicheKey } from "@studio/domain";
import type { NicheTemplateSummary } from "@studio/niches";

import { FIELD_ERROR_CLASSES, INPUT_CLASSES, deriveTitlePlaceholder, type StepErrors, type WizardState } from "../shared";

// Step 1 — "Niche & topic". Presentational: state, validation, and the niche
// switch semantics (format/style reset + duration clamp) live in WizardForm.

interface StepNicheTopicProps {
  templates: NicheTemplateSummary[];
  state: WizardState;
  errors: StepErrors;
  disabled: boolean;
  onSelectNiche: (key: NicheKey) => void;
  onPatch: (patch: Partial<WizardState>) => void;
}

export default function StepNicheTopic({
  templates,
  state,
  errors,
  disabled,
  onSelectNiche,
  onPatch,
}: StepNicheTopicProps) {
  return (
    <section className="mt-6 space-y-6">
      <fieldset disabled={disabled}>
        <legend className="text-sm font-medium text-neutral-200">Niche</legend>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {templates.map((template) => {
            const selected = template.key === state.nicheKey;
            return (
              <button
                key={template.key}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelectNiche(template.key)}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  selected
                    ? "border-neutral-300 bg-neutral-800/60 ring-1 ring-neutral-300"
                    : "border-neutral-800 bg-neutral-900 hover:border-neutral-600"
                }`}
              >
                <span className="block text-sm font-medium text-neutral-100">{template.label}</span>
                <span className="mt-1 block text-xs text-neutral-400">{template.description}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="block text-sm" htmlFor="wizard-topic">
        Topic
        <textarea
          id="wizard-topic"
          required
          maxLength={TOPIC_MAX}
          rows={3}
          disabled={disabled}
          className={`mt-1 ${INPUT_CLASSES}`}
          value={state.topic}
          aria-invalid={Boolean(errors.topic) || undefined}
          aria-describedby={errors.topic ? "wizard-topic-error" : undefined}
          onChange={(event) => onPatch({ topic: event.target.value })}
        />
        <span className="mt-1 flex items-center justify-between text-xs text-neutral-500">
          <span>What should the video be about?</span>
          <span>
            {state.topic.length}/{TOPIC_MAX}
          </span>
        </span>
        {errors.topic ? (
          <span id="wizard-topic-error" className={FIELD_ERROR_CLASSES}>
            {errors.topic}
          </span>
        ) : null}
      </label>

      <label className="block text-sm" htmlFor="wizard-title">
        Title <span className="font-normal text-neutral-500">(optional)</span>
        <input
          id="wizard-title"
          type="text"
          maxLength={PROJECT_TITLE_MAX}
          disabled={disabled}
          className={`mt-1 ${INPUT_CLASSES}`}
          placeholder={deriveTitlePlaceholder(state.topic)}
          value={state.title}
          aria-invalid={Boolean(errors.title) || undefined}
          aria-describedby={errors.title ? "wizard-title-error" : undefined}
          onChange={(event) => onPatch({ title: event.target.value })}
        />
        <span className="mt-1 block text-xs text-neutral-500">
          Leave blank to derive the title from the topic — the placeholder previews the derivation.
        </span>
        {errors.title ? (
          <span id="wizard-title-error" className={FIELD_ERROR_CLASSES}>
            {errors.title}
          </span>
        ) : null}
      </label>
    </section>
  );
}
