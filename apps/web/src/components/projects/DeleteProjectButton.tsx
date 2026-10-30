"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Two-click confirm instead of window.confirm: the first click arms the
// button and swaps the label, so the destructive intent is explicit without
// a modal; moving focus away (or a finished attempt) disarms it.
//
// Failure copy follows the same rule as EditProjectForm — the API envelope
// message or a fixed fallback, never anything the caller supplied. A 409
// means the unique-active-job guard fired and gets its own fixed copy;
// every other failure (including a 404 from RLS hiding the row from a
// non-owner) surfaces through the envelope message without the UI claiming
// to know the cause.
async function envelopeMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

const ACTIVE_JOB_CONFLICT = "This project has an active job — cancel it first.";

interface DeleteProjectButtonProps {
  projectId: string;
}

export default function DeleteProjectButton({ projectId }: DeleteProjectButtonProps) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!armed) {
      setArmed(true);
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/projects/${projectId}`, { method: "DELETE" });

      if (!response.ok) {
        setArmed(false);
        setPending(false);
        setError(
          response.status === 409
            ? ACTIVE_JOB_CONFLICT
            : await envelopeMessage(response, "delete failed"),
        );
        return;
      }

      // The row is gone server-side; /dashboard is dynamic and always
      // re-renders server-side on navigation, so a refresh of the
      // just-deleted /projects/[id] route would only race a not-found
      // payload — push straight to the grid.
      router.push("/dashboard");
    } catch {
      // A rejected fetch must not leave the button stuck on "Deleting…"
      // with an unhandled rejection.
      setArmed(false);
      setPending(false);
      setError("Could not reach the server. Check your connection and try again.");
    }
  }

  return (
    <div>
      {error ? (
        <p className="mb-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={handleDelete}
        onBlur={() => setArmed(false)}
        disabled={pending}
        className={
          armed
            ? "rounded-lg border border-red-800 bg-red-950/60 px-3 py-1.5 text-sm text-red-300 transition-colors hover:border-red-600 disabled:opacity-60"
            : "rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:border-neutral-500 disabled:opacity-60"
        }
      >
        {pending ? "Deleting…" : armed ? "Click again to delete" : "Delete project"}
      </button>
    </div>
  );
}
