/** Normalize a persisted or IPC launch-at-startup boolean. */
export function normalizeLaunchAtStartup(value: unknown): boolean {
  return value === true;
}
