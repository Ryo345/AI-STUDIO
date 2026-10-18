# AI Video Automation Studio

Turn a topic into a production-ready YouTube video across multiple niches (horror, automotive, education, documentary, gaming, custom): a timed script, storyboard, voiceover, visual assets, synchronized captions, and a rendered MP4 — faceless.

**Status: Phase 1 in active development.** The phase map lives in `docs/architecture.md`.

## What works today

- Monorepo scaffold (M0): npm-workspaces layout, six `@studio/*` packages, credential-free test harness.

*Populated as milestones complete.*

## Monorepo layout

| Path | Purpose |
|---|---|
| `apps/web` | Next.js frontend + `/api/v1` route handlers |
| `apps/worker` | Background job worker (script generation now; rendering in Phase 2) |
| `packages/domain` | Zod schemas + types — single source of truth for API + DB shapes |
| `packages/niches` | Niche template registry (mock + real LLM share it) |
| `packages/db` | Supabase clients, typed queries, queue RPC wrappers |
| `packages/providers` | Scriptwriter/TTS/image/storage provider adapters |
| `packages/pipeline` | Pure pipeline logic: beats, normalization, timing (captions/ffmpeg in Phase 2) |
| `packages/queue-core` | Pure job state machine + backoff math |
| `supabase/migrations` | SQL migrations + RLS policies |

## Quickstart

```bash
npm install
npm test          # credential-free unit tests
npm run typecheck
```

The Supabase project setup guide (`docs/supabase-setup.md`) lands with milestone M2. `npm run dev` (web + worker) arrives with milestones M3/M5.

## Phases

1. **Phase 1 (current)** — auth, workspaces, dashboard, wizard, niche templates, queue-based script generation (default: deterministic mock), storyboard editing, job retry/cancel, usage accounting.
2. **Phase 2** — TTS, media assets (AI + licensed stock), captions, FFmpeg rendering, MP4 export, thumbnails/metadata.
3. **Phase 3** — YouTube upload + scheduling.

## Honesty rules

- With no AI keys configured, the app runs a deterministic **mock scriptwriter**; every mock artifact is visibly badged **MOCK** in the UI and flagged in stored provenance and usage records. Mock output is never presented as a real generated video.
- A configured-but-broken provider never silently falls back to the mock: the worker refuses to boot and jobs stay `pending` until the misconfiguration is fixed.
