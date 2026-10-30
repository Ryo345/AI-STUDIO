"use client";

// Route-segment error boundary for the app pages (dashboard + project
// detail). The RSC tier has no withApiHandler equivalent: any throw from a
// server component's DB read — a transient outage, or the RLS 42501s that
// are live until migration 0005 is applied — would otherwise render Next's
// unstyled default error page with no way back. reset() re-renders the
// segment, which re-runs the failed server read.
export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Fixed copy only: the caught error's message is server internals we
  // must not echo, mirroring the API envelope rule.
  return (
    <main className="mx-auto max-w-3xl p-6">
      <section className="mt-16 rounded-xl border border-red-900/60 bg-neutral-900 p-6">
        <h1 className="text-lg font-semibold text-neutral-100">Something went wrong</h1>
        <p className="mt-2 text-sm text-neutral-400">
          This page failed to load. That is usually temporary — try again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
