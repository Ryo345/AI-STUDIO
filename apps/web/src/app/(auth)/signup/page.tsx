"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { sanitizeNextPath } from "@/lib/http";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const supabase = getSupabaseBrowserClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Derived from the page origin — no hardcoded host, no extra env var.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setPending(false);
      return;
    }

    // Dev setup (docs/supabase-setup.md) disables email confirmation, so a
    // session comes back immediately and we head straight in. When a project
    // keeps confirmation enabled there is no session yet — say so instead of
    // pretending the user is signed in.
    if (data.session) {
      const next = sanitizeNextPath(new URLSearchParams(window.location.search).get("next"));
      router.refresh();
      router.push(next);
      return;
    }

    setAwaitingConfirmation(true);
  }

  if (awaitingConfirmation) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center">
          <h1 className="text-xl font-semibold">Check your email</h1>
          <p className="mt-3 text-sm text-neutral-400">
            We sent a confirmation link to <span className="text-neutral-200">{email}</span>.
            Click it to finish creating your account — you'll land back in the studio.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <h1 className="text-xl font-semibold">Create your account</h1>
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
              autoComplete="new-password"
              minLength={6}
              required
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 focus:border-neutral-500 focus:outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="mt-1 block text-xs text-neutral-500">At least 6 characters.</span>
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
            {pending ? "Creating account…" : "Sign up"}
          </button>
        </form>

        <p className="mt-4 text-sm text-neutral-400">
          Already registered?{" "}
          <Link className="text-neutral-200 underline hover:text-white" href="/login">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
