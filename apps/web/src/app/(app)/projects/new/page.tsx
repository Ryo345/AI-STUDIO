import Link from "next/link";

import WizardForm from "@/components/wizard/WizardForm";
import { listedNicheTemplates, templateSummary, type NicheTemplateSummary } from "@studio/niches";

// M4 wizard entry. The only server work is flattening the niche registry into
// wizard-facing summaries: templateSummary returns plain data (strings,
// numbers, string-keyed records — see packages/niches/src/registry.ts), so the
// array crosses the server/client boundary as-is with no adapters. There are
// no DB reads and nothing user-specific on this page — the middleware page
// guard is what keeps the route signed-in-only.
export default function NewProjectPage() {
  const templates: NicheTemplateSummary[] = listedNicheTemplates.map(templateSummary);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link
        href="/dashboard"
        className="text-sm text-neutral-400 transition-colors hover:text-neutral-200"
      >
        ← Back to projects
      </Link>

      <header className="mt-4">
        <h1 className="text-xl font-semibold">New project</h1>
        <p className="mt-0.5 text-sm text-neutral-400">
          Pick a niche, shape the video, review, create.
        </p>
      </header>

      <WizardForm templates={templates} />
    </main>
  );
}
