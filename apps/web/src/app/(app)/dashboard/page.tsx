import Link from "next/link";
import { redirect } from "next/navigation";

import SignOutButton from "@/components/SignOutButton";
import { getPrimaryWorkspaceId, listActiveJobsByProject, listProjects } from "@studio/db";
import type { JobDTO, ProjectDTO, ProjectStatus } from "@studio/domain";
import { resolveNiche } from "@studio/niches";
import { getScriptwriterProviderStatus, type ProviderStatus } from "@/lib/providers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Dates render in a fixed locale/zone: the server's own locale/timezone
// would pick the display day (off-by-one for non-UTC users), and if this
// markup ever moves into a client component the server-TZ string would
// hydrate differently than the browser. Module-level so the formatter is
// built once, not per card.
const DATE_FORMAT = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

// M4 dashboard: the M3 scaffold becomes the projects grid. Every read runs
// on the USER-SESSION client, so RLS is the enforcement layer — the
// workspace id is resolved server-side from the caller's membership
// (getPrimaryWorkspaceId), never from a client-supplied value.
export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Pure env read, not a fetch: honesty about mock generation must not
  // depend on a request that could silently fail.
  const provider = getScriptwriterProviderStatus();
  const workspaceId = await getPrimaryWorkspaceId(supabase, user.id);

  // No membership row yet (the handle_new_user trigger creates the
  // workspace at signup) — explain instead of crashing on a null workspace.
  if (!workspaceId) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">AI Video Automation Studio</h1>
            <p className="mt-0.5 text-sm text-neutral-400">{user.email}</p>
          </div>
          <SignOutButton />
        </header>

        <ProviderBanner provider={provider} />

        <section className="mt-8 rounded-xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">
          <p>Your workspace has not been provisioned yet.</p>
          <p className="mt-1">
            A workspace is created automatically when your account is set up — try signing
            out and back in. Projects will appear here once it exists.
          </p>
        </section>
      </main>
    );
  }

  const projects = await listProjects(supabase, workspaceId, { limit: 20, offset: 0 });
  // One batched jobs lookup for the whole grid instead of a query per card.
  const activeJobs = await listActiveJobsByProject(
    supabase,
    projects.map((project) => project.id),
  );

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">AI Video Automation Studio</h1>
          <p className="mt-0.5 text-sm text-neutral-400">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/projects/new"
            className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white"
          >
            New project
          </Link>
          <SignOutButton />
        </div>
      </header>

      <ProviderBanner provider={provider} />

      {projects.length === 0 ? (
        <section className="mt-8 rounded-xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">
          <p className="text-neutral-200">No projects yet.</p>
          <p className="mt-1">Create your first project to start generating scripts.</p>
          <Link
            href="/projects/new"
            className="mt-4 inline-block rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white"
          >
            Create your first project
          </Link>
        </section>
      ) : (
        <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              activeJob={activeJobs.get(project.id)?.[0]}
            />
          ))}
        </section>
      )}
    </main>
  );
}

// Status colors are cosmetic only — the status text always rides in the
// chip, so the color never carries the meaning on its own.
const STATUS_CHIP_CLASSES: Record<ProjectStatus, string> = {
  draft: "border-neutral-700 bg-neutral-800/60 text-neutral-300",
  generating: "animate-pulse border-amber-700 bg-amber-950/60 text-amber-300",
  ready: "border-emerald-700 bg-emerald-950/60 text-emerald-300",
  editing: "border-blue-700 bg-blue-950/60 text-blue-300",
  archived: "border-neutral-800 bg-neutral-900 text-neutral-500",
};

function StatusChip({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${STATUS_CHIP_CLASSES[status]}`}
    >
      {status}
    </span>
  );
}

// The MOCK badge is unmissable on purpose (project honesty rule): generated
// output must never be mistaken for real provider output. For real providers
// the same slot shows readiness — or the missing-variable detail, which
// names env vars, never secret values.
function ProviderBanner({ provider }: { provider: ProviderStatus }) {
  const configure = (
    <Link
      href="/settings/providers"
      className="ml-auto shrink-0 text-sm underline transition-colors hover:text-white"
    >
      Provider settings
    </Link>
  );

  if (provider.isMock) {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-700 bg-amber-950/50 px-4 py-3 text-sm text-amber-200">
        <span className="rounded-md bg-amber-400 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-950">
          MOCK
        </span>
        <span>{provider.id} scriptwriter active — generated scripts are placeholders</span>
        {configure}
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
      <span className="font-medium text-neutral-100">{provider.id}</span>
      {provider.ready ? (
        <span className="text-emerald-400">ready</span>
      ) : (
        <span className="text-red-400">{provider.detail}</span>
      )}
      {configure}
    </div>
  );
}

// The whole card is one Link (no nested anchors): the title reads as the
// card heading and the click target is the full tile.
function ProjectCard({
  project,
  activeJob,
}: {
  project: ProjectDTO;
  activeJob?: JobDTO;
}) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="block rounded-xl border border-neutral-800 bg-neutral-900 p-5 transition-colors hover:border-neutral-600"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-medium text-neutral-100">{project.title}</h2>
        <StatusChip status={project.status} />
      </div>
      <p className="mt-1 text-xs text-neutral-500">{resolveNiche(project.niche).label}</p>
      <p className="mt-3 line-clamp-2 text-sm text-neutral-400">{project.topic}</p>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-xs text-neutral-500">
          Updated {DATE_FORMAT.format(new Date(project.updatedAt))}
        </span>
        {/* listActiveJobsByProject only returns pending/running jobs. */}
        {activeJob ? (
          <span className="shrink-0 rounded-full border border-amber-800 bg-amber-950/60 px-2 py-0.5 text-xs text-amber-300">
            generating… · {activeJob.status}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
