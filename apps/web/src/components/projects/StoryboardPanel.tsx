"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ProjectStatus, SceneDTO, ScriptVersionDTO } from "@studio/domain";

// StoryboardPanel — the script surface on the project detail page.
//
// Shows the current script version + its scenes; each scene's narration,
// visual description, on-screen text, and duration are editable inline
// (PATCH /scenes/:sceneId). Regenerate enqueues a fresh generation
// (POST /generate) — the router decides the provider, so the panel never
// claims to know which model will run. Provenance is shown as-is with the
// unmissable MOCK badge whenever isMock is set (project honesty rule).

async function envelopeMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

interface StoryboardPanelProps {
  projectId: string;
  version: ScriptVersionDTO | null;
  scenes: SceneDTO[];
  status: ProjectStatus;
  activeJobId: string | null;
}

export default function StoryboardPanel({
  projectId,
  version,
  scenes,
  status,
  activeJobId,
}: StoryboardPanelProps) {
  const router = useRouter();
  const [regenPending, setRegenPending] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  async function handleRegenerate() {
    setRegenPending(true);
    setRegenError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as {
        job?: { id: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        setRegenError(body.error?.message ?? "could not start generation");
        return;
      }
      // 202: the job is enqueued and the project is 'generating'. The server
      // page re-render shows the active job + generating state.
      router.refresh();
    } catch {
      setRegenError("Could not reach the server. Check your connection and try again.");
    } finally {
      setRegenPending(false);
    }
  }

  async function handleCancelJob() {
    if (!activeJobId) return;
    setRegenPending(true);
    setRegenError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/jobs/${activeJobId}/cancel`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        setRegenError(body.error?.message ?? "could not request cancellation");
        return;
      }
      router.refresh();
    } catch {
      setRegenError("Could not reach the server. Check your connection and try again.");
    } finally {
      setRegenPending(false);
    }
  }

  const generating = status === "generating" || activeJobId !== null;

  return (
    <section className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-neutral-300">Storyboard</h2>
          {version ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <span>
                v{version.versionNumber} ·{" "}
                {DATE_TIME_FORMAT.format(new Date(version.createdAt))} UTC
              </span>
              <span className="font-mono text-neutral-400">
                {version.provenance.providerId}
                {version.provenance.model ? ` · ${version.provenance.model}` : ""}
              </span>
              {version.provenance.isMock ? <MockBadge /> : null}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {generating ? (
            <button
              type="button"
              onClick={handleCancelJob}
              disabled={regenPending || !activeJobId}
              className="rounded-lg border border-red-900 px-3 py-1.5 text-sm text-red-300 transition-colors hover:border-red-600 disabled:opacity-60"
            >
              Cancel job
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={regenPending}
              className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:opacity-60"
            >
              {regenPending ? "Starting…" : version ? "Regenerate script" : "Generate script"}
            </button>
          )}
        </div>
      </div>

      {regenError ? (
        <p className="mt-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300" role="alert">
          {regenError}
        </p>
      ) : null}

      {generating ? (
        <p className="mt-3 text-sm text-amber-300">
          Script generation is in progress — the storyboard refreshes when the worker finishes.
        </p>
      ) : null}

      {version && scenes.length > 0 ? (
        <ol className="mt-4 space-y-3">
          {scenes.map((scene) => (
            <SceneCard key={scene.id} projectId={projectId} scene={scene} />
          ))}
        </ol>
      ) : !generating ? (
        <p className="mt-4 rounded-xl border border-dashed border-neutral-800 p-4 text-sm text-neutral-400">
          No script yet — generate one to start the storyboard.
        </p>
      ) : null}
    </section>
  );
}

function SceneCard({ projectId, scene }: { projectId: string; scene: SceneDTO }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [narration, setNarration] = useState(scene.narration);
  const [visualDescription, setVisualDescription] = useState(scene.visualDescription);
  const [onScreenText, setOnScreenText] = useState(scene.onScreenText ?? "");
  const [durationSeconds, setDurationSeconds] = useState(String(Math.round(scene.durationMs / 1000)));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    setEditing(false);
    setError(null);
    setNarration(scene.narration);
    setVisualDescription(scene.visualDescription);
    setOnScreenText(scene.onScreenText ?? "");
    setDurationSeconds(String(Math.round(scene.durationMs / 1000)));
  }

  async function handleSave() {
    // Send only what changed — an unchanged field is left to the stored row.
    const durationMs = Math.round(Number(durationSeconds) * 1000);
    const patch: Record<string, unknown> = {};
    if (narration !== scene.narration) patch["narration"] = narration.trim();
    if (visualDescription !== scene.visualDescription) patch["visualDescription"] = visualDescription.trim();
    if ((scene.onScreenText ?? "") !== onScreenText) patch["onScreenText"] = onScreenText.trim() === "" ? null : onScreenText.trim();
    if (durationMs !== scene.durationMs) patch["durationMs"] = durationMs;

    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    if (typeof patch["narration"] === "string" && patch["narration"] === "") {
      setError("Narration cannot be empty.");
      return;
    }
    if (!Number.isFinite(durationMs) || durationMs < 800 || durationMs > 60_000) {
      setError("Duration must be between 1 and 60 seconds.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/scenes/${scene.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(body.error?.message ?? "scene update failed");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs font-medium text-neutral-300">
          Scene {scene.position + 1}
        </span>
        <span className="text-xs text-neutral-500">
          {Math.round(scene.durationMs / 1000)}s
          {scene.onScreenText ? ` · "${scene.onScreenText}"` : ""}
        </span>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-auto text-xs text-neutral-400 underline hover:text-neutral-200"
          >
            Edit
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-3 space-y-3" aria-live="polite">
          <label className="block text-sm" htmlFor={`scene-narration-${scene.id}`}>
            <span className="text-neutral-400">Narration</span>
            <textarea
              id={`scene-narration-${scene.id}`}
              required
              minLength={1}
              maxLength={4000}
              rows={3}
              disabled={pending}
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 focus:border-neutral-500 focus:outline-none"
              value={narration}
              onChange={(event) => setNarration(event.target.value)}
            />
          </label>
          <label className="block text-sm" htmlFor={`scene-visual-${scene.id}`}>
            <span className="text-neutral-400">Visual description</span>
            <textarea
              id={`scene-visual-${scene.id}`}
              maxLength={2000}
              rows={2}
              disabled={pending}
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 focus:border-neutral-500 focus:outline-none"
              value={visualDescription}
              onChange={(event) => setVisualDescription(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="block grow text-sm" htmlFor={`scene-ost-${scene.id}`}>
              <span className="text-neutral-400">On-screen text</span>
              <input
                id={`scene-ost-${scene.id}`}
                type="text"
                maxLength={120}
                disabled={pending}
                placeholder="empty = none"
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                value={onScreenText}
                onChange={(event) => setOnScreenText(event.target.value)}
              />
            </label>
            <label className="block text-sm" htmlFor={`scene-duration-${scene.id}`}>
              <span className="text-neutral-400">Duration (s)</span>
              <input
                id={`scene-duration-${scene.id}`}
                type="number"
                min={1}
                max={60}
                step={0.1}
                disabled={pending}
                className="mt-1 w-24 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 focus:border-neutral-500 focus:outline-none"
                value={durationSeconds}
                onChange={(event) => setDurationSeconds(event.target.value)}
              />
            </label>
          </div>

          {error ? (
            <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={pending}
              className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save scene"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={pending}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:border-neutral-500 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-line text-sm text-neutral-200">{scene.narration}</p>
      )}

      {!editing && scene.visualDescription ? (
        <p className="mt-2 text-xs text-neutral-500">Visual: {scene.visualDescription}</p>
      ) : null}
    </li>
  );
}

function MockBadge() {
  return (
    <span className="rounded-md bg-amber-400 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-950">
      MOCK
    </span>
  );
}
