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
export function reportBackgroundError(kind: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
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
