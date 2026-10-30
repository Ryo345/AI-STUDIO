"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { PROJECT_TITLE_MAX, TOPIC_MAX, type ProjectStatus } from "@studio/domain";

// Inline editor for the two user-editable project fields plus archive
// state. The PATCH surface is deliberately narrow — title/topic on Save and
// exactly one of "draft"|"archived" on the status button, matching
// updateProjectSchema server-side. Nothing else from this component is ever
// sent, so form state cannot smuggle fields into the patch.
//
// Failure copy comes from the API envelope ({ error: { message } }) or a
// fixed fallback — never from anything the user typed. A non-editor's PATCH
// is hidden by RLS and surfaces as 404; the envelope message is shown
// as-is, without the UI claiming to know which failure it was.
async function envelopeMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    // A non-JSON or empty body has nothing worth quoting.
    return fallback;
  }
}

interface EditProjectFormProps {
  projectId: string;
  initialTitle: string;
  initialTopic: string;
  status: ProjectStatus;
}

export default function EditProjectForm({
  projectId,
  initialTitle,
  initialTopic,
  status,
}: EditProjectFormProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [topic, setTopic] = useState(initialTopic);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: { title?: string; topic?: string; status?: "draft" | "archived" }) {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        setError(await envelopeMessage(response, "update failed"));
        setPending(false);
        return;
      }
    } catch {
      // A rejected fetch (offline, dropped connection) must not leave the
      // controls disabled forever with an unhandled rejection.
      setError("Could not reach the server. Check your connection and try again.");
      setPending(false);
      return;
    }

    // 200: router.refresh() re-renders the server page with fresh rows; the
    // local inputs already hold what the server stored.
    setPending(false);
    // Only a title/topic save closes the editor — a status toggle must not
    // discard edits the user typed but has not saved yet. Syncing the state
    // to the saved values keeps a reopened editor from showing a draft that
    // no longer matches the server.
    if (body.title !== undefined) setTitle(body.title);
    if (body.topic !== undefined) setTopic(body.topic);
    if (body.title !== undefined || body.topic !== undefined) {
      setEditing(false);
    }
    router.refresh();
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await patch({ title: title.trim(), topic: topic.trim() });
  }

  function handleCancel() {
    setEditing(false);
    setError(null);
    setTitle(initialTitle);
    setTopic(initialTopic);
  }

  return (
    <div className="mt-3">
      {error ? (
        <p className="mb-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      {/* Swapping the button for the form (or back) is silent to screen
          readers otherwise — the live region announces the revealed panel. */}
      <div aria-live="polite">
        {editing ? (
          <form className="space-y-4" onSubmit={handleSave}>
            <label className="block text-sm" htmlFor="project-title">
              Title
              <input
                id="project-title"
                type="text"
                required
                maxLength={PROJECT_TITLE_MAX}
                disabled={pending}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            <label className="block text-sm" htmlFor="project-topic">
              Topic
              <textarea
                id="project-topic"
                required
                minLength={3}
                maxLength={TOPIC_MAX}
                rows={3}
                disabled={pending}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
              />
            </label>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save"}
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
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:border-neutral-500"
          >
            Edit title / topic
          </button>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => patch({ status: status === "archived" ? "draft" : "archived" })}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:border-neutral-500 disabled:opacity-60"
        >
          {status === "archived" ? "Unarchive" : "Archive"}
        </button>
        <span className="text-xs text-neutral-500">
          {status === "archived"
            ? "Unarchive to bring the project back into the active workflow."
            : "Archiving keeps the project readable but out of the active workflow."}
        </span>
      </div>
    </div>
  );
}
