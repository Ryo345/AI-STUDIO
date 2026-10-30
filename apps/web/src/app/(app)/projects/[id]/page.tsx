import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import DeleteProjectButton from "@/components/projects/DeleteProjectButton";
import EditProjectForm from "@/components/projects/EditProjectForm";
import { getProjectRow, listActiveJobsByProject } from "@studio/db";
import type { ProjectStatus } from "@studio/domain";
import { resolveNiche } from "@studio/niches";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// A malformed id can never match a row, so rejecting it here is both the
// correct answer (404) and skips a pointless database round-trip.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Timestamps render in a fixed locale/zone (UTC): the server's own
// locale/timezone would pick the display day (off-by-one for non-UTC
// users), and if this header ever moves into a client component the
// server-TZ string would hydrate differently than the browser.
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

// Chip colors mirror the dashboard grid. Duplicated inline on purpose: M4's
// file list is fixed and the palette is six lines — a shared component file
// can be extracted once more than one page family needs it.
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

// M4 project detail SHELL — no scene UI here (script generation and scene
// editing arrive in M5). The project is read through the USER-SESSION
// client, so RLS is the authorization layer: a foreign or deleted project
// reads as null and renders 404 with no existence leak — the same contract
// the API tier applies to hidden rows.
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Next 15: dynamic route params arrive as a Promise.
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const project = await getProjectRow(supabase, id);
  if (!project) {
    notFound();
  }

  // Only pending/running jobs come back — exactly the ones worth showing.
  // listActiveJobsByProject groups by projectId; this page reads a single one.
  const activeJobs = (await listActiveJobsByProject(supabase, [id])).get(id) ?? [];

  // Style ids resolve back to labels through the niche template so the
  // summary speaks the wizard's language; an id the current template no
  // longer knows falls back to the raw id instead of disappearing.
  const template = resolveNiche(project.niche);
  const visualStyle = template.visualStylePresets.find(
    (preset) => preset.id === project.config.visualStyleId,
  );
  const musicMood = template.musicMoods.find(
    (mood) => mood.id === project.config.musicMoodId,
  );

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link
        href="/dashboard"
        className="text-sm text-neutral-400 underline hover:text-neutral-200"
      >
        ← Dashboard
      </Link>

      <header className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">{project.title}</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {template.label} · {project.config.aspectRatio} ·{" "}
            {project.config.targetDurationSeconds}s · {project.config.format}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Created {DATE_TIME_FORMAT.format(new Date(project.createdAt))} · Updated{" "}
            {DATE_TIME_FORMAT.format(new Date(project.updatedAt))}
          </p>
        </div>
        <StatusChip status={project.status} />
      </header>

      <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <h2 className="text-sm font-medium text-neutral-300">Topic</h2>
        <p className="mt-2 whitespace-pre-line text-sm text-neutral-100">{project.topic}</p>
      </section>

      <section className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <h2 className="text-sm font-medium text-neutral-300">Config</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-neutral-500">Aspect ratio</dt>
            <dd className="text-neutral-200">{project.config.aspectRatio}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Target duration</dt>
            <dd className="text-neutral-200">{project.config.targetDurationSeconds}s</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Format</dt>
            <dd className="text-neutral-200">{project.config.format}</dd>
          </div>
          {project.config.visualStyleId ? (
            <div>
              <dt className="text-neutral-500">Visual style</dt>
              <dd className="text-neutral-200">
                {visualStyle?.label ?? project.config.visualStyleId}
              </dd>
            </div>
          ) : null}
          {project.config.musicMoodId ? (
            <div>
              <dt className="text-neutral-500">Music mood</dt>
              <dd className="text-neutral-200">
                {musicMood?.label ?? project.config.musicMoodId}
              </dd>
            </div>
          ) : null}
          {project.config.captionStyleId ? (
            <div>
              <dt className="text-neutral-500">Caption style</dt>
              <dd className="text-neutral-200">{project.config.captionStyleId}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {activeJobs.length > 0 ? (
        <section className="mt-4 rounded-xl border border-amber-900/60 bg-neutral-900 p-6">
          <h2 className="text-sm font-medium text-neutral-300">Active jobs</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {activeJobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-2 text-neutral-300">
                <code className="rounded bg-neutral-950 px-1.5 py-0.5 text-xs text-neutral-400">
                  {job.id.slice(0, 8)}
                </code>
                <span>{job.type}</span>
                <span className="text-amber-300">{job.status}</span>
                <span className="text-neutral-500">
                  attempt {job.attempt}/{job.maxAttempts}
                </span>
                {job.cancelRequested ? (
                  <span className="rounded-full border border-red-900 bg-red-950/60 px-2 py-0.5 text-xs text-red-300">
                    cancel requested
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* M5 mounts the storyboard (script version + scenes) here. */}
      <section className="mt-4 rounded-xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">
        <h2 className="text-sm font-medium text-neutral-300">Storyboard</h2>
        <p className="mt-2">Script generation and scene editing arrive in M5.</p>
        {project.status === "generating" ? (
          <p className="mt-2 text-amber-300">Script generation is in progress.</p>
        ) : null}
      </section>

      <section className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <h2 className="text-sm font-medium text-neutral-300">Settings</h2>
        <EditProjectForm
          projectId={project.id}
          initialTitle={project.title}
          initialTopic={project.topic}
          status={project.status}
        />

        <div className="mt-6 border-t border-neutral-800 pt-6">
          <h3 className="text-sm font-medium text-neutral-300">Danger zone</h3>
          <p className="mt-1 text-sm text-neutral-400">
            Deleting removes this project for everyone in the workspace. A project with an
            active job cannot be deleted until that job finishes or is cancelled.
          </p>
          <div className="mt-3">
            <DeleteProjectButton projectId={project.id} />
          </div>
        </div>
      </section>
    </main>
  );
}
