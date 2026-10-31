# Environment Variables — Reference

Single source of truth for every environment variable. `.env.example` carries
the same keys with inline hints; this file documents **who reads what, when,
and why**.

**Never commit `.env`** — it is gitignored. Placeholders in
`.env.example` are the only tracked env content.

## Legend

- **Web** = the Next.js app (`apps/web`) — runs with the browser-visible
  `NEXT_PUBLIC_*` set and the anon key; has **no** access to secrets.
- **Worker** = the background job process (M5) — the only process that loads
  provider keys and the service-role key.
- **Test** = `npm run test:int`, gated by `INT=1`.

## Supabase

| Variable | Read by | Required | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Web, Worker, Test | always | Project URL (`https://xxxx.supabase.co`). The worker also accepts legacy `SUPABASE_URL`; both work. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Web, Test | always | Browser-safe key. All requests through it are subject to RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker, Test | worker + tests | Bypasses RLS. **Never** `NEXT_PUBLIC_`-prefixed, never imported by `apps/web`. Worker RPC-only usage is enforced by grants (revoked from `anon`/`authenticated`). |

`@studio/db`'s `loadDbConfig()` validates all three at process boot and
**fail-fasts** with `DbConfigurationError` on: missing values, non-`https://`
URLs, leftover placeholders (`YOUR_`, `example.com`), or suspiciously short
service keys (< 40 chars).

## Scriptwriter provider (worker only)

The worker produces scripts through one pluggable adapter. Selecting a real
provider without its credentials is a **boot failure**, never a silent
fallback to the mock — mock output must never masquerade as a real call, and
vice versa.

| Variable | Read by | Required | Purpose |
| --- | --- | --- | --- |
| `SCRIPTWRITER_PROVIDER` | Worker | no (default `mock`) | `mock` \| `anthropic` \| `openai-compatible` |
| `PROVIDER_TIMEOUT_MS` | Worker | no (default `120000`) | Per-call timeout; a timeout is a retryable job failure |
| `MOCK_GENERATE_DELAY_MS` | Worker | no (default `0`) | Simulated latency for the mock — set e.g. `60000` to exercise cancel/heartbeat/reclaim paths without ANY credentials |

### Anthropic (when `SCRIPTWRITER_PROVIDER=anthropic`)

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | API key |
| `ANTHROPIC_MODEL` | Model id from the provider's current model list — deliberately not hardcoded anywhere |
| `ANTHROPIC_BASE_URL` | Optional override (default `https://api.anthropic.com`) — for proxies/gateways speaking the Messages API |

### OpenAI-compatible (when `SCRIPTWRITER_PROVIDER=openai-compatible`)

| Variable | Purpose |
| --- | --- |
| `OPENAI_COMPATIBLE_BASE_URL` | e.g. `https://api.openai.com/v1` or `https://openrouter.ai/api/v1` |
| `OPENAI_COMPATIBLE_API_KEY` | API key for that gateway |
| `OPENAI_COMPATIBLE_MODEL` | Model id the gateway offers |

## Worker tuning (all optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `WORKER_POLL_MS` | `2000` | Poll interval while jobs may be pending |
| `WORKER_IDLE_POLL_MS` | `15000` | Backoff poll interval after consecutive empty claims |
| `WORKER_CLAIM_BATCH` | `2` | Claims per poll cycle (server clamps 1–10) |
| `WORKER_STALE_LOCK_SECONDS` | `300` | A `running` lock older than this is reclaimable after a crash |

## Integration tests

| Variable | Purpose |
| --- | --- |
| `INT` | `1` = run `npm run test:int` against the real Supabase project in `.env`. Anything else (or a missing Supabase var) = suite **silently skips**. Use a disposable project — tests create and delete real rows. |

## Rules that keep this list honest

1. **Nothing secret under `NEXT_PUBLIC_`.** The prefix means "bundle into the
   browser" — anything carrying it is public by construction.
2. **No provider key in the web app.** Providers are called exclusively by
   the worker; the web tier only enqueues jobs and reads results.
3. **No silent fallback between mock and real.** A misconfigured provider
   fails loudly at boot; users see an honest MOCK badge in the UI whenever
   mock output flows.
