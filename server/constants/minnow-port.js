/**
 * Default HTTP port for Minnow's Vite + tool server.
 * Intentionally not 5173 (Vite's upstream default) so workspace agents can run
 * `npm run dev` without colliding with the host app.
 */

/** @type {number} */
export const MINNOW_DEFAULT_PORT = 9473;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
export function resolveMinnowPort(env = process.env) {
  const raw = env.PORT ?? env.MINNOW_PORT;
  // Legacy shells often export PORT=5173 (old Vite default). Reserve 5173 for workspace apps.
  if (raw === '5173' || raw === 5173) {
    return MINNOW_DEFAULT_PORT;
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0 && n < 65536) return Math.floor(n);
  return MINNOW_DEFAULT_PORT;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function defaultMinnowLocalOrigin(env = process.env) {
  return `http://localhost:${resolveMinnowPort(env)}`;
}
