"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import type { AspectRatio, NicheKey, ScriptFormat } from "@studio/domain";
import type { NicheTemplateSummary } from "@studio/niches";

import StepFormatLength from "./steps/StepFormatLength";
import StepNicheTopic from "./steps/StepNicheTopic";
import StepReview from "./steps/StepReview";
import StepStyle from "./steps/StepStyle";
import {
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  clampInt,
  step1Errors,
  step2Errors,
  type StepErrors,
  type WizardState,
} from "./shared";

// M4 project creation wizard — the only surface that creates projects. All
// wizard state lives in this one component (a single WizardState object plus
// per-step validation), and the browser never touches Supabase: the POST goes
// to /api/v1/projects, where createProjectSchema and the niche duration bands
// re-validate everything. The checks below gate Next/Create and surface
// errors inline — they are UX, not security; the API tier is the authority.
//
// The four step components under ./steps are presentational: they receive the
// state slice, the live errors, and callbacks, and own no logic of their own.
//
// `templates` arrives from the server page as NicheTemplateSummary[] — plain
// serializable data (templateSummary in packages/niches/src/registry.ts), safe
// to pass across the server/client boundary. Nothing here is hard-coded to a
// niche: labels, bands, and style lists all come from the summaries, so adding
// a template to the registry grows this wizard for free.

const STEP_LABELS: readonly string[] = ["Niche & topic", "Format & length", "Style", "Review"];

// Same contract as the other M4 client forms (EditProjectForm): failure copy
// comes from the API envelope ({ error: { message } }) or a fixed fallback —
// never from anything the user typed.
async function envelopeMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    // A non-JSON or empty body has nothing worth quoting.
    return fallback;
  }
}

function initialState(templates: NicheTemplateSummary[]): WizardState {
  // listedNicheTemplates is a non-empty, integrity-checked constant (five
  // seeded niches — packages/niches/src/registry.ts), so the assertion below
  // cannot fire on a real render.
  const first = templates[0]!;
  return {
    nicheKey: first.key,
    topic: "",
    title: "",
    format: first.defaultFormat,
    aspectRatio: "9:16",
    // Rest the slider at the band's ideal, not its floor — the niche's
    // recommended length is a better default than the shortest allowed.
    targetDurationSeconds: first.durationBands["9:16"].idealSeconds,
    visualStyleId: "",
    musicMoodId: "",
    instructions: "",
    autoGenerate: true,
  };
}

export default function WizardForm({ templates }: { templates: NicheTemplateSummary[] }) {
  const router = useRouter();
  const [state, setState] = useState<WizardState>(() => initialState(templates));
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rebuilt per render on purpose — memoizing a five-entry map costs more
  // than it saves.
  const templateByKey = new Map<NicheKey, NicheTemplateSummary>(
    templates.map((template) => [template.key, template]),
  );
  // nicheKey only ever changes through selectNiche, so the lookup always
  // hits; the fallback keeps noUncheckedIndexedAccess honest.
  const selectedTemplate = templateByKey.get(state.nicheKey) ?? templates[0]!;

  // Annotated so the empty step-3/4 branch types as StepErrors instead of
  // widening to a union that hides the field keys.
  const errors: StepErrors =
    step === 1 ? step1Errors(state) : step === 2 ? step2Errors(state, selectedTemplate) : {};
  const stepValid = Object.keys(errors).length === 0;
  // Create gates on every step, not just the current one: steps 1–2 can only
  // break while they are active, but gating globally enforces that invariant
  // instead of assuming it.
  const allValid =
    Object.keys(step1Errors(state)).length === 0 &&
    Object.keys(step2Errors(state, selectedTemplate)).length === 0;

  function patchState(patch: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...patch }));
  }

  function selectNiche(key: NicheKey) {
    const template = templateByKey.get(key);
    if (!template) return;
    setState((prev) => {
      const nextBand = template.durationBands[prev.aspectRatio];
      return {
        ...prev,
        nicheKey: key,
        // Everything scoped to the old template resets with it: the format
        // follows the new niche's default, and the style ids belong to the
        // previous niche's option lists (a stale id would match no option).
        format: template.defaultFormat,
        visualStyleId: "",
        musicMoodId: "",
        // Bands differ per niche, so the duration clamps into the new one
        // instead of silently staying out of range.
        targetDurationSeconds: clampInt(
          prev.targetDurationSeconds,
          nextBand.minSeconds,
          nextBand.maxSeconds,
        ),
      };
    });
  }

  function selectAspect(aspectRatio: AspectRatio) {
    setState((prev) => {
      const nextBand = selectedTemplate.durationBands[aspectRatio];
      return {
        ...prev,
        aspectRatio,
        // Bands are per aspect (vertical shorts run tighter than landscape),
        // so the duration clamps into the newly selected band.
        targetDurationSeconds: clampInt(
          prev.targetDurationSeconds,
          nextBand.minSeconds,
          nextBand.maxSeconds,
        ),
      };
    });
  }

  function setDurationFromInput(raw: string) {
    const band = selectedTemplate.durationBands[state.aspectRatio];
    // Clearing snaps to the band floor so the field keeps a number and the
    // slider gives the value a visible landing spot. Partial typing ("9" en
    // route to "90") is NOT clamped here — rewriting the field mid-keystroke
    // corrupts input (1 → 45 → 458). The inline error plus clamp-on-blur
    // handle transient out-of-band values instead.
    if (raw.trim() === "") {
      patchState({ targetDurationSeconds: band.minSeconds });
      return;
    }
    const next = Number(raw);
    if (!Number.isFinite(next)) return;
    patchState({ targetDurationSeconds: Math.trunc(next) });
  }

  function clampDurationToBand() {
    const band = selectedTemplate.durationBands[state.aspectRatio];
    patchState({
      targetDurationSeconds: clampInt(
        state.targetDurationSeconds,
        band.minSeconds,
        band.maxSeconds,
      ),
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Enter inside a text input submits the <form> from any step — only the
    // review step's Create may reach the API.
    if (step !== 4 || submitting) return;
    setSubmitting(true);
    setError(null);

    // Optional fields are only present when chosen: an untouched select reads
    // "" and must ship as absence, not an empty string.
    const config: {
      aspectRatio: AspectRatio;
      targetDurationSeconds: number;
      format: ScriptFormat;
      visualStyleId?: string;
      musicMoodId?: string;
      instructions?: string;
    } = {
      aspectRatio: state.aspectRatio,
      targetDurationSeconds: state.targetDurationSeconds,
      format: state.format,
    };
    if (state.visualStyleId) config.visualStyleId = state.visualStyleId;
    if (state.musicMoodId) config.musicMoodId = state.musicMoodId;
    const instructions = state.instructions.trim();
    if (instructions) config.instructions = instructions;

    try {
      const response = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          niche: state.nicheKey,
          topic: state.topic.trim(),
          title: state.title.trim() || undefined,
          config,
          autoGenerate: state.autoGenerate,
        }),
      });

      if (!response.ok) {
        setError(await envelopeMessage(response, "Could not create the project. Please try again."));
        setSubmitting(false);
        return;
      }

      // 201 per the POST /projects contract; parsed defensively because a
      // 2xx body that cannot be read must not crash the page.
      const body = (await response.json().catch(() => null)) as {
        data?: { project?: { id?: string } };
      } | null;
      const projectId = body?.data?.project?.id;
      if (!projectId) {
        setError(
          "The project was created, but the response did not include its id. Open the dashboard to continue.",
        );
        setSubmitting(false);
        return;
      }

      router.push(`/projects/${projectId}`);
      // Navigating away — `submitting` stays true on purpose so Create
      // cannot double-post during the transition.
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-8" onSubmit={handleSubmit}>
      {error ? (
        <p className="mb-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Wizard steps">
        {STEP_LABELS.map((label, index) => {
          const stepNumber = index + 1;
          const current = stepNumber === step;
          return (
            <li
              key={label}
              aria-current={current ? "step" : undefined}
              className={`rounded-full border px-3 py-1 ${
                current
                  ? "border-neutral-300 bg-neutral-800/60 text-neutral-100"
                  : stepNumber < step
                    ? "border-neutral-800 text-neutral-400"
                    : "border-neutral-800 text-neutral-600"
              }`}
            >
              {stepNumber}. {label}
            </li>
          );
        })}
      </ol>

      {/* Advancing swaps this entire panel, but the step list's aria-current
          change is not announced — the live region makes screen readers
          surface the new panel's content on every step change. */}
      <div aria-live="polite">
        {step === 1 ? (
          <StepNicheTopic
            templates={templates}
            state={state}
            errors={errors}
            disabled={submitting}
            onSelectNiche={selectNiche}
            onPatch={patchState}
          />
        ) : null}

        {step === 2 ? (
          <StepFormatLength
            template={selectedTemplate}
            state={state}
            errors={errors}
            disabled={submitting}
            onPatch={patchState}
            onSelectAspect={selectAspect}
            onDurationInput={setDurationFromInput}
            onDurationBlur={clampDurationToBand}
          />
        ) : null}

        {step === 3 ? (
          <StepStyle
            template={selectedTemplate}
            state={state}
            disabled={submitting}
            onPatch={patchState}
          />
        ) : null}

        {step === 4 ? (
          <StepReview
            template={selectedTemplate}
            state={state}
            disabled={submitting}
            onPatch={patchState}
          />
        ) : null}
      </div>

      <div className="mt-8 flex items-center justify-between gap-3">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            disabled={submitting}
            className={SECONDARY_BUTTON}
          >
            Back
          </button>
        ) : (
          <span />
        )}

        {step < 4 ? (
          <button
            type="button"
            onClick={() => setStep(step + 1)}
            disabled={!stepValid || submitting}
            className={PRIMARY_BUTTON}
          >
            Next
          </button>
        ) : (
          <button type="submit" disabled={!allValid || submitting} className={PRIMARY_BUTTON}>
            {submitting ? "Creating…" : "Create project"}
          </button>
        )}
      </div>
    </form>
  );
}
