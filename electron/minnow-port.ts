export const MINNOW_DEFAULT_PORT = 9473;

export function resolveMinnowPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PORT ?? env.MINNOW_PORT;
  if (raw === '5173') {
    return MINNOW_DEFAULT_PORT;
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0 && n < 65536) return Math.floor(n);
  return MINNOW_DEFAULT_PORT;
}
