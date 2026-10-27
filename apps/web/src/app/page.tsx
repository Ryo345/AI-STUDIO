import { redirect } from "next/navigation";

// There is no landing page in Phase 1 — the app starts at the dashboard.
// Middleware re-guards unauthenticated visitors to /login.
export default function HomePage() {
  redirect("/dashboard");
}
