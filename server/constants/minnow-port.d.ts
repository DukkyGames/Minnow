/** Default HTTP port for Minnow's Vite + tool server (not Vite's 5173). */
export const MINNOW_DEFAULT_PORT: number;

/** Resolve PORT / MINNOW_PORT from env, else MINNOW_DEFAULT_PORT. */
export function resolveMinnowPort(env?: NodeJS.ProcessEnv): number;

/** Default local origin, e.g. http://localhost:9473 */
export function defaultMinnowLocalOrigin(env?: NodeJS.ProcessEnv): string;
