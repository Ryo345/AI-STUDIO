// Supabase environment contract, enforced fail-fast: a missing or
// placeholder key throws at boot with a message pointing at the setup doc —
// never a silent undefined that surfaces as a confusing 500 later.

export const SUPABASE_SETUP_DOC = 'docs/supabase-setup.md';

export class DbConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbConfigurationError';
  }
}

export interface DbConfig {
  url: string;
  serviceRoleKey: string;
}

function required(env: NodeJS.ProcessEnv, names: string[], what: string): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  throw new DbConfigurationError(
    `${names.join(' or ')} is required (${what}). Copy it from .env.example into .env — walkthrough: ${SUPABASE_SETUP_DOC}.`,
  );
}

/**
 * Worker/server-side configuration. Accepts both SUPABASE_URL and
 * NEXT_PUBLIC_SUPABASE_URL (only one is needed; the NEXT_PUBLIC spelling is
 * accepted so a single .env can serve web + worker).
 */
export function loadDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const url = required(env, ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'], 'Supabase project URL');
  const serviceRoleKey = required(
    env,
    ['SUPABASE_SERVICE_ROLE_KEY'],
    'service-role key — worker ONLY, bypasses RLS, must NEVER reach the browser',
  );

  if (!url.startsWith('https://')) {
    throw new DbConfigurationError(`Supabase URL must be https, got: ${url}`);
  }
  // `YOUR-` too: .env.example's URL template reads `https://YOUR-PROJECT-REF.supabase.co`
  // — the hyphen spelling is real, and an underscore-only check let it slip.
  const upperUrl = url.toUpperCase();
  if (url.includes('example.com') || upperUrl.includes('YOUR_') || upperUrl.includes('YOUR-')) {
    throw new DbConfigurationError(`Supabase URL still contains template placeholders — edit .env`);
  }
  if (serviceRoleKey.length < 40 || serviceRoleKey.includes('YOUR_')) {
    throw new DbConfigurationError('SUPABASE_SERVICE_ROLE_KEY looks like a placeholder — paste the real key');
  }

  return { url, serviceRoleKey };
}

/** True when enough Supabase env is present for integration tests to run. */
export function integrationTestEnvAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.INT === '1' &&
    Boolean(env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(env.SUPABASE_SERVICE_ROLE_KEY) &&
    Boolean(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY)
  );
}
