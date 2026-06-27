/**
 * Default HTTP port for Minnow's Vite + tool server.
 * Keep in sync with server/constants/minnow-port.js (see minnow-port-constant.test.mjs).
 */

/** Default Minnow host port — not Vite's upstream 5173 default. */
export const MINNOW_DEFAULT_PORT = 9473;

/** Resolve PORT / MINNOW_PORT from env, else {@link MINNOW_DEFAULT_PORT}. */
export function resolveMinnowPort(env: Record<string, string | undefined> = {}): number {
  const raw = env.PORT ?? env.MINNOW_PORT;
  if (raw === '5173') {
    return MINNOW_DEFAULT_PORT;
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0 && n < 65536) return Math.floor(n);
  return MINNOW_DEFAULT_PORT;
}

/** Default local origin for headless CLI fallbacks. */
export function defaultMinnowLocalOrigin(
  env: Record<string, string | undefined> = {},
): string {
  return `http://localhost:${resolveMinnowPort(env)}`;
}
