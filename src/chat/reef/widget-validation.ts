/**
 * Reef widget iframe validation timing and test hooks (host preflight before reveal).
 */

/** Milliseconds after iframe load before failing closed when no validateResult arrives. */
export const REEF_WIDGET_VALIDATION_TIMEOUT_MS = 5000;

/** Brief grace after validateResult when resize is still in flight (hidden probe iframe). */
export const REEF_WIDGET_VALIDATION_RESIZE_GRACE_MS = 300;

/** Minimum measured content height (px) to treat a widget as rendered. */
export const REEF_WIDGET_MIN_CONTENT_HEIGHT_PX = 24;

let skipValidationTimeoutForTests = false;
let autoRevealWidgetsForTests = false;

/** Skip the validation timeout (happy-dom does not run srcdoc). */
export function setSkipReefWidgetValidationTimeoutForTests(skip: boolean): void {
  skipValidationTimeoutForTests = skip;
}

/** Immediately reveal widgets after mount (unit tests only). */
export function setAutoRevealReefWidgetsForTests(autoReveal: boolean): void {
  autoRevealWidgetsForTests = autoReveal;
}

/** Legacy helper: skip timeout + auto-reveal (mount/detector tests). */
export function setSkipReefWidgetValidationForTests(skip: boolean): void {
  skipValidationTimeoutForTests = skip;
  autoRevealWidgetsForTests = skip;
}

export function shouldRunReefWidgetValidationTimeout(): boolean {
  return !skipValidationTimeoutForTests;
}

export function shouldAutoRevealReefWidgetsForTests(): boolean {
  return autoRevealWidgetsForTests;
}

/** Test hook: reset flags. */
export function resetReefWidgetValidationFlagsForTests(): void {
  skipValidationTimeoutForTests = false;
  autoRevealWidgetsForTests = false;
}
