// Browser-safe (NEXT_PUBLIC_) Supabase config with the same fail-fast
// posture as @studio/db's loadDbConfig: a missing or placeholder value
// crashes loudly instead of producing confusing downstream request errors.
//
// This module must never read anything but NEXT_PUBLIC-prefixed vars —
// the web tier cannot have secrets (docs/architecture.md, key exposure
// matrix). The anon key is public by design; RLS enforces everything.

export interface PublicAppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

function readPublicEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY"): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `[web config] ${name} is not set. Copy .env.example to .env and fill in values from the Supabase dashboard — see docs/supabase-setup.md.`,
    );
  }

  if (/YOUR_|example\.com|^<|>$/.test(value)) {
    throw new Error(
      `[web config] ${name} still holds a placeholder value. Paste the real value from the Supabase dashboard (docs/supabase-setup.md).`,
    );
  }

  if (name === "NEXT_PUBLIC_SUPABASE_URL" && !/^https:\/\//.test(value)) {
    throw new Error(`[web config] NEXT_PUBLIC_SUPABASE_URL must be an https:// project URL.`);
  }

  return value;
}

export function getPublicAppConfig(): PublicAppConfig {
  return {
    supabaseUrl: readPublicEnv("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: readPublicEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
}
