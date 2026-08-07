/**
 * Renderer-side prep before preview guest screenshot capture (browser_screenshot, design diffs).
 */

export const PREVIEW_GUEST_LOAD_POLL_MS = 50;
export const PREVIEW_GUEST_LOAD_MAX_WAIT_MS = 3_000;

/** Poll `getInfo().loading` until idle or timeout (mirrors browser_eval guard, but waits). */
export async function pollPreviewGuestUntilIdle(
  getInfo: () => Promise<{ loading?: boolean } | undefined>,
  options?: { maxWaitMs?: number; pollMs?: number },
): Promise<void> {
  const maxWaitMs = options?.maxWaitMs ?? PREVIEW_GUEST_LOAD_MAX_WAIT_MS;
  const pollMs = options?.pollMs ?? PREVIEW_GUEST_LOAD_POLL_MS;
  const start = Date.now();
  let info = await getInfo();
  while (info?.loading && Date.now() - start < maxWaitMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
    info = await getInfo();
  }
}

/** Reveal the preview split and sync native WebContentsView bounds before capture. */
export async function prepareElectronPreviewForCapture(): Promise<void> {
  if (typeof document === 'undefined') return;
  const { showPreviewSplit } = await import('./file-layout');
  const { syncElectronPreviewHostLayout } = await import('./preview-electron-visibility');
  showPreviewSplit();
  await syncElectronPreviewHostLayout();
}
