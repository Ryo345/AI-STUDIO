"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { sanitizeNextPath } from "@/lib/http";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

// Fixed copy for the reasons the auth callback sends; anything else found in
// the ?error= param is ignored rather than reflected into the login card.
const CALLBACK_ERROR_COPY: Record<string, string> = {
  "missing-code": "That sign-in link is missing its auth code — sign in instead.",
  "exchange-failed":
    "That sign-in link didn't work — it may have expired or already been used. Sign in instead.",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // The PKCE callback redirects failures back here as ?error=<reason> with a
  // fixed code. Free-form text is never accepted — an attacker-crafted link
  // must not be able to render arbitrary copy inside the login card.
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    const copy = reason ? CALLBACK_ERROR_COPY[reason] : undefined;
    if (copy) {
      setError(copy);
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const supabase = getSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setPending(false);
      return;
    }

    // Middleware and server components only observe the new session cookies
    // after a refresh; the target page re-guards itself on arrival.
    const next = sanitizeNextPath(new URLSearchParams(window.location.search).get("next"));
    router.refresh();
    router.push(next);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-neutral-400">AI Video Automation Studio</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm" htmlFor="email">
            Email
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="block text-sm" htmlFor="password">
            Password
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 focus:border-neutral-500 focus:outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error ? (
            <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-neutral-100 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-sm text-neutral-400">
          No account yet?{" "}
          <Link className="text-neutral-200 underline hover:text-white" href="/signup">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
