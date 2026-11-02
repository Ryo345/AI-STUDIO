"use client";

import { useState } from "react";

import type { ConnectionProviderId, ProviderConnectionDTO } from "@studio/domain";

// ConnectionsManager — add / test / update / delete BYOK keys.
//
// The plaintext key lives only in this component's input state until the
// request is sent; the API encrypts it and answers with masked metadata
// only. keyHint in every response is the display form ('nvapi-…9f2c') —
// the component must never claim to hold the real key.

const PROVIDERS: Array<{ id: ConnectionProviderId; label: string; needsBaseUrl: boolean; docs: string }> = [
  {
    id: "nvidia-nim",
    label: "NVIDIA NIM",
    needsBaseUrl: false,
    docs: "Get a key at build.nvidia.com — starts with nvapi-",
  },
  { id: "anthropic", label: "Anthropic", needsBaseUrl: false, docs: "Keys start with sk-ant-" },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible endpoint",
    needsBaseUrl: true,
    docs: "vLLM, LM Studio, OpenRouter, … — base URL required",
  },
];

async function envelopeMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export default function ConnectionsManager({
  initialConnections,
}: {
  initialConnections: ProviderConnectionDTO[];
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [notice, setNotice] = useState<string | null>(null);

  function upsertConnection(next: ProviderConnectionDTO) {
    setConnections((current) => {
      const index = current.findIndex((c) => c.id === next.id);
      if (index === -1) return [...current, next];
      const copy = [...current];
      copy[index] = next;
      return copy;
    });
  }

  return (
    <div className="mt-4 space-y-4">
      {connections.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-800 p-4 text-sm text-neutral-400">
          No provider connections yet — add one below.
        </p>
      ) : (
        connections.map((connection) => (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            onChanged={upsertConnection}
            onRemoved={(id) => setConnections((current) => current.filter((c) => c.id !== id))}
            onNotice={setNotice}
          />
        ))
      )}

      <AddConnectionForm onAdded={upsertConnection} onNotice={setNotice} />

      {notice ? (
        <p className="rounded-lg bg-neutral-800/80 px-3 py-2 text-sm text-neutral-200" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function ConnectionCard({
  connection,
  onChanged,
  onRemoved,
  onNotice,
}: {
  connection: ProviderConnectionDTO;
  onChanged: (connection: ProviderConnectionDTO) => void;
  onRemoved: (id: string) => void;
  onNotice: (message: string | null) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [pending, setPending] = useState<"test" | "update" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testModels, setTestModels] = useState<string[] | null>(null);

  async function handleTest() {
    // The test endpoint validates a key against the provider. For the stored
    // connection the user re-enters (or pastes) the key — the web tier cannot
    // decrypt stored envelopes by design, so a re-test of a saved key means
    // re-entering it. Copy says so plainly.
    if (!apiKey.trim()) {
      setShowKeyInput(true);
      setError("Enter the API key to test (keys are never stored readable — re-enter to verify).");
      return;
    }
    setPending("test");
    setError(null);
    try {
      const response = await fetch(`/api/v1/providers/connections/${connection.id}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const body = (await response.json()) as {
        test?: { ok: boolean; error?: { message: string } | null };
        models?: string[];
        connection?: ProviderConnectionDTO;
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "connection test failed");
        return;
      }
      if (body.connection) onChanged(body.connection);
      setTestModels(body.test?.ok ? (body.models ?? []) : null);
      onNotice(body.test?.ok ? "Connection OK" : null);
      if (!body.test?.ok && body.test?.error) setError(body.test.error.message);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  async function handleUpdate() {
    if (!apiKey.trim()) {
      setError("Enter a new API key first.");
      return;
    }
    setPending("update");
    setError(null);
    try {
      const response = await fetch(`/api/v1/providers/connections/${connection.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const body = (await response.json()) as {
        connection?: ProviderConnectionDTO;
        error?: { message?: string };
      };
      if (!response.ok || !body.connection) {
        setError(body.error?.message ?? "key update failed");
        return;
      }
      onChanged(body.connection);
      setApiKey("");
      setShowKeyInput(false);
      onNotice("Key updated — re-test to activate.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  async function handleDelete() {
    setPending("delete");
    setError(null);
    try {
      const response = await fetch(`/api/v1/providers/connections/${connection.id}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        setError(await envelopeMessage(response, "delete failed"));
        return;
      }
      onRemoved(connection.id);
      onNotice("Connection removed.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-neutral-100">{connection.providerId}</span>
        <span className="font-mono text-sm text-neutral-400">{connection.keyHint}</span>
        <StatusBadge status={connection.status} />
      </div>

      {connection.lastTestError ? (
        <p className="mt-2 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300" role="alert">
          Last test failed: {connection.lastTestError.message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {testModels ? (
        <p className="mt-2 text-xs text-neutral-500">
          {testModels.length} models available — the model picker lists them live.
        </p>
      ) : null}

      {showKeyInput ? (
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="Paste API key"
          autoComplete="off"
          className="mt-3 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600"
        />
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={pending !== null}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:border-neutral-500 disabled:opacity-60"
        >
          {pending === "test" ? "Testing…" : "Test connection"}
        </button>
        <button
          type="button"
          onClick={() => {
            setShowKeyInput((value) => !value);
            setError(null);
          }}
          disabled={pending !== null}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:border-neutral-500 disabled:opacity-60"
        >
          {showKeyInput ? "Cancel" : "Replace key"}
        </button>
        {showKeyInput ? (
          <button
            type="button"
            onClick={handleUpdate}
            disabled={pending !== null || !apiKey.trim()}
            className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:opacity-60"
          >
            {pending === "update" ? "Saving…" : "Save new key"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending !== null}
          className="ml-auto rounded-lg border border-red-900 px-3 py-1.5 text-sm text-red-300 transition-colors hover:border-red-600 disabled:opacity-60"
        >
          {pending === "delete" ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ProviderConnectionDTO["status"] }) {
  const classes =
    status === "active"
      ? "border-emerald-700 bg-emerald-950/60 text-emerald-300"
      : status === "failed"
        ? "border-red-800 bg-red-950/60 text-red-300"
        : "border-neutral-700 bg-neutral-800/60 text-neutral-300";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${classes}`}>
      {status}
    </span>
  );
}

function AddConnectionForm({
  onAdded,
  onNotice,
}: {
  onAdded: (connection: ProviderConnectionDTO) => void;
  onNotice: (message: string | null) => void;
}) {
  const [providerId, setProviderId] = useState<ConnectionProviderId>("nvidia-nim");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = PROVIDERS.find((p) => p.id === providerId) ?? PROVIDERS[0]!;

  async function handleSubmit() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/providers/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId,
          apiKey: apiKey.trim(),
          ...(selected.needsBaseUrl ? { baseUrl: baseUrl.trim() } : {}),
        }),
      });
      const body = (await response.json()) as {
        connection?: ProviderConnectionDTO;
        error?: { message?: string };
      };
      if (!response.ok || !body.connection) {
        setError(body.error?.message ?? "could not save the connection");
        return;
      }
      onAdded(body.connection);
      setApiKey("");
      setBaseUrl("");
      onNotice("Connection added — test it to activate.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <h3 className="text-sm font-medium text-neutral-100">Add a connection</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-[200px_1fr]">
        <select
          value={providerId}
          onChange={(event) => setProviderId(event.target.value as ConnectionProviderId)}
          className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
        >
          {PROVIDERS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={selected.docs}
          autoComplete="off"
          className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600"
        />
        {selected.needsBaseUrl ? (
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://your-endpoint.example.com/v1"
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 sm:col-span-2"
          />
        ) : null}
      </div>
      {error ? (
        <p className="mt-2 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={pending || !apiKey.trim() || (selected.needsBaseUrl && !baseUrl.trim())}
        className="mt-3 rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Add connection"}
      </button>
    </div>
  );
}
