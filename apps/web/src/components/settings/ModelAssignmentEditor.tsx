"use client";

import { useMemo, useState } from "react";

import type {
  AiTask,
  ConnectionProviderId,
  ModelAssignmentDTO,
  ProviderConnectionDTO,
} from "@studio/domain";

// ModelAssignmentEditor — the model router UI. One row per task: provider +
// model + save. The workspace 'default' row is first-class; task rows
// override it. Model options come from the live provider catalog (POST
// /api/v1/providers/catalog with a key from the matching connection)…
//
// except the catalog fetch needs the plaintext key, which the browser never
// holds for saved connections. So the model field is a TEXT INPUT seeded
// with the currently assigned model, not a dropdown — honest about what the
// web tier knows. The catalog endpoint exists for the add-connection flow,
// where the user is typing the key anyway; wiring it into that flow happens
// when the add form moves into this editor.

const TASKS: Array<{ id: AiTask; label: string; hint: string }> = [
  { id: "default", label: "Workspace default", hint: "Used when a task has no override" },
  { id: "script.generate", label: "Script generation", hint: "Drafts the full timed script" },
  { id: "script.rewrite", label: "Script rewriting", hint: "Revise an existing script" },
  { id: "research.assist", label: "Research assistance", hint: "Background material for a topic" },
  { id: "fact.check", label: "Fact-checking", hint: "Verify claims in a draft script" },
  { id: "scene.describe", label: "Scene descriptions", hint: "Visual prompts per scene" },
  { id: "video.title", label: "Video titles", hint: "Title candidates" },
  { id: "video.description", label: "Video descriptions", hint: "Platform descriptions" },
  { id: "seo.metadata", label: "SEO metadata", hint: "Tags and metadata" },
  { id: "script.quality", label: "Script quality evaluation", hint: "Score + critique drafts" },
];

const PROVIDER_IDS: ConnectionProviderId[] = ["nvidia-nim", "anthropic", "openai-compatible"];

async function envelopeMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export default function ModelAssignmentEditor({
  initialAssignments,
  connections,
}: {
  initialAssignments: ModelAssignmentDTO[];
  connections: ProviderConnectionDTO[];
}) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const [notice, setNotice] = useState<string | null>(null);

  const byTask = useMemo(() => {
    const map = new Map<AiTask, ModelAssignmentDTO>();
    for (const assignment of assignments) map.set(assignment.task, assignment);
    return map;
  }, [assignments]);

  const connectedProviders = useMemo(
    () => new Set(connections.filter((c) => c.status !== "failed").map((c) => c.providerId)),
    [connections],
  );

  function upsertLocal(next: ModelAssignmentDTO) {
    setAssignments((current) => {
      const index = current.findIndex((a) => a.task === next.task);
      if (index === -1) return [...current, next];
      const copy = [...current];
      copy[index] = next;
      return copy;
    });
  }

  return (
    <div className="mt-4 space-y-3">
      {TASKS.map((task) => (
        <AssignmentRow
          key={task.id}
          task={task.id}
          label={task.label}
          hint={task.hint}
          assignment={byTask.get(task.id) ?? null}
          connectedProviders={connectedProviders}
          onSaved={upsertLocal}
          onDeleted={(removedTask) =>
            setAssignments((current) => current.filter((a) => a.task !== removedTask))
          }
          onNotice={setNotice}
        />
      ))}

      {notice ? (
        <p className="rounded-lg bg-neutral-800/80 px-3 py-2 text-sm text-neutral-200" role="status">
          {notice}
        </p>
      ) : null}

      {connections.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-800 p-4 text-sm text-neutral-400">
          Routing requires a provider connection — add one above first.
        </p>
      ) : null}
    </div>
  );
}

function AssignmentRow({
  task,
  label,
  hint,
  assignment,
  connectedProviders,
  onSaved,
  onDeleted,
  onNotice,
}: {
  task: AiTask;
  label: string;
  hint: string;
  assignment: ModelAssignmentDTO | null;
  connectedProviders: Set<ConnectionProviderId>;
  onSaved: (assignment: ModelAssignmentDTO) => void;
  onDeleted: (task: AiTask) => void;
  onNotice: (message: string | null) => void;
}) {
  const [providerId, setProviderId] = useState<ConnectionProviderId>(
    assignment?.providerId ?? "nvidia-nim",
  );
  const [model, setModel] = useState(assignment?.model ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = connectedProviders.has(providerId);

  async function handleSave() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/model-assignments", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, providerId, model: model.trim() }),
      });
      const body = (await response.json()) as {
        assignment?: ModelAssignmentDTO;
        error?: { message?: string };
      };
      if (!response.ok || !body.assignment) {
        setError(body.error?.message ?? "could not save the assignment");
        return;
      }
      onSaved(body.assignment);
      onNotice(`${label} routing saved.`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/model-assignments?task=${encodeURIComponent(task)}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        setError(await envelopeMessage(response, "could not remove the assignment"));
        return;
      }
      onDeleted(task);
      onNotice(`${label} override removed.`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-sm font-medium text-neutral-100">{label}</span>
        <span className="text-xs text-neutral-500">{hint}</span>
        {assignment ? (
          <span className="ml-auto font-mono text-xs text-neutral-400">
            {assignment.providerId} · {assignment.model}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={providerId}
          onChange={(event) => setProviderId(event.target.value as ConnectionProviderId)}
          className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100"
        >
          {PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="model id (from the provider's catalog)"
          spellCheck={false}
          className="min-w-64 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 font-mono text-sm text-neutral-100 placeholder:text-neutral-600"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !model.trim()}
          className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:opacity-60"
        >
          {pending ? "Saving…" : assignment ? "Update" : "Assign"}
        </button>
        {assignment ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-neutral-500 disabled:opacity-60"
          >
            Remove
          </button>
        ) : null}
      </div>

      {!connected && assignment?.providerId === providerId ? (
        <p className="mt-2 text-xs text-amber-400">
          {providerId} has no active connection — jobs routed here will fail until you add its key.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
