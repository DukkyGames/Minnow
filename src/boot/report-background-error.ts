/**
 * Best-effort logger for errors that would otherwise be swallowed in background
 * or event-dispatch paths (stream-end listeners, board change emitters, fire-and-
 * forget task launches). Routes to the main-process crash log (crash.jsonl) when
 * the Electron bridge is present, and always logs to the console.
 *
 * This helper must never throw — it runs from `catch` blocks and `.catch()`
 * handlers whose entire job is to keep a failure from disappearing silently.
 * It is intentionally dependency-light (no UI imports) so it is safe to call
 * from low-level modules and from node test environments where `window` is
 * undefined.
 */

const DEDUPE_WINDOW_MS = 5_000;

/** kind+message → { count of suppressed repeats, pending flush timer }. */
const recentErrors = new Map<string, { count: number; flushTimer: ReturnType<typeof setTimeout> }>();

function emitError(kind: string, message: string, stack: string | undefined): void {
  // eslint-disable-next-line no-console
  console.error(`[${kind}] ${message}`, stack ?? '');
  try {
    if (typeof window !== 'undefined') {
      window.minnow?.diagnostics?.reportError?.({ kind, message, stack });
    }
  } catch {
    /* logging must never throw */
  }
}

export function reportBackgroundError(kind: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  const key = `${kind}\x00${message}`;

  const existing = recentErrors.get(key);
  if (existing) {
    existing.count++;
    return;
  }

  emitError(kind, message, stack);

  // Register a dedupe window; identical errors within it are counted, then
  // a single summary line is emitted when the window closes.
  let entry!: { count: number; flushTimer: ReturnType<typeof setTimeout> };
  const flushTimer = setTimeout(() => {
    recentErrors.delete(key);
    if (entry.count > 0) {
      emitError(kind, `${message} (×${entry.count} suppressed)`, undefined);
    }
  }, DEDUPE_WINDOW_MS);
  entry = { count: 0, flushTimer };
  recentErrors.set(key, entry);
}
