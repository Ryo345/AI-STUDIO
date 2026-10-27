import { redirect } from "next/navigation";

import SignOutButton from "@/components/SignOutButton";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// M3 shell: proves the session wiring end-to-end. The workspace auto-created
// by the handle_new_user trigger backs every future query here; the projects
// grid, wizard, and job UI arrive with M4–M5.
export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">AI Video Automation Studio</h1>
          <p className="mt-0.5 text-sm text-neutral-400">{user.email}</p>
        </div>
        <SignOutButton />
      </header>

      <section className="mt-8 rounded-xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">
        <p>Dashboard scaffold — nothing lives here yet.</p>
        <p className="mt-1">
          Projects, the creation wizard, and script jobs land in milestones M4–M5.
        </p>
      </section>
    </main>
  );
}
