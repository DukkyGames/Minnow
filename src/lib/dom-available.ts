/** True when browser DOM globals exist (false in headless Node tests). */
export function isDomAvailable(): boolean {
  return typeof document !== 'undefined' && typeof HTMLElement !== 'undefined';
}
