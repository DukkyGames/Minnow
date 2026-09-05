/**
 * Late-bound hook so theme/font/custom-color writes can request a disk flush
 * without importing the HTTP persist module (avoids a cycle with theme.ts).
 */

type AppearancePersistScheduler = () => void;

let scheduler: AppearancePersistScheduler = () => {};

/** Install the debounce+PUT implementation from persist.ts at boot. */
export function setAppearancePersistScheduler(fn: AppearancePersistScheduler): void {
  scheduler = fn;
}

/** Ask the installed scheduler to write ~/.minnow/appearance.json. */
export function scheduleAppearancePersist(): void {
  scheduler();
}
