import { jsonOk } from "@/lib/api/errors";

// Public liveness probe — deliberately unauthenticated so a monitor can
// reach it without a session. It exposes nothing but the fact that the
// process is up (no version, no config, no key state).

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return jsonOk({ status: "ok" });
}
