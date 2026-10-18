// @studio/queue-core — pure job-queue state machine and backoff math.
// No I/O here: the worker owns all database interaction; this package owns
// transition rules and retry math so they are unit-testable without Supabase.
// Populated in milestone M5.

export const QUEUE_CORE_VERSION = '0.1.0';
