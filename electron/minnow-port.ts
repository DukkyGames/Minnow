/**
 * Default Minnow host port for the Electron main process.
 * Keep in sync with server/constants/minnow-port.js (see minnow-port-constant.test.mjs).
 */

/** Default HTTP port — not Vite's upstream 5173. */
export const MINNOW_DEFAULT_PORT = 9473;

/** Resolve PORT / MINNOW_PORT from env, else {@link MINNOW_DEFAULT_PORT}. */
export function resolveMinnowPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PORT ?? env.MINNOW_PORT;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0 && n < 65536) return Math.floor(n);
  return MINNOW_DEFAULT_PORT;
}
