import Link from "next/link";
import { redirect } from "next/navigation";

import SignOutButton from "@/components/SignOutButton";
import ConnectionsManager from "@/components/settings/ConnectionsManager";
import ModelAssignmentEditor from "@/components/settings/ModelAssignmentEditor";
import { getPrimaryWorkspaceId, listModelAssignments, listProviderConnections } from "@studio/db";
import type { ModelAssignmentDTO, ProviderConnectionDTO } from "@studio/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// /settings/providers — BYOK command center: encrypted key storage
// (masked display, test, update, delete) + the model router editor
// (task → provider/model with a workspace default).
//
// The page is a server component; every read runs on the USER-SESSION
// client so RLS scopes rows. The masked DTOs (key_hint, never ciphertext)
// are all that ever reaches this markup — the encryption column is not even
// selectable for user sessions (0006 column grants).

export const dynamic = "force-dynamic";

export default async function ProviderSettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const workspaceId = await getPrimaryWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <SettingsHeader email={user.email ?? ""} />
        <section className="mt-8 rounded-xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">
          <p>Your workspace has not been provisioned yet — provider settings need it.</p>
        </section>
      </main>
    );
  }

  const [connections, assignments] = await Promise.all([
    listProviderConnections(supabase, workspaceId),
    listModelAssignments(supabase, workspaceId),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <SettingsHeader email={user.email ?? ""} />

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-neutral-100">Provider connections</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Bring your own API keys. Keys are encrypted at rest (AES-256-GCM), shown masked, and
          never leave the server after submission.
        </p>
        <ConnectionsManager initialConnections={connections} />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-neutral-100">Model routing</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Assign a provider + model to each AI task. A task row overrides the workspace default;
          without any assignment, generation falls back to this deployment's configured
          scriptwriter.
        </p>
        <ModelAssignmentEditor
          initialAssignments={assignments}
          connections={connections}
        />
      </section>
    </main>
  );
}

function SettingsHeader({ email }: { email: string }) {
  return (
    <header className="flex items-center justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold">Provider settings</h1>
        <p className="mt-0.5 text-sm text-neutral-400">
          <Link href="/dashboard" className="underline hover:text-neutral-200">
            Dashboard
          </Link>{" "}
          · {email}
        </p>
      </div>
      <SignOutButton />
    </header>
  );
}

// Re-export for typed client-component props without widening visibility of
// the ciphertext (it never appears here anyway).
export type { ProviderConnectionDTO, ModelAssignmentDTO };
