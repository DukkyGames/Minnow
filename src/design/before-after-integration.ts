/**
 * Before/after diff wiring (MIN-370 P1): connects the pure pairing state machine
 * (before-after.ts) to the real preview guest (full-viewport screenshot capture) and to
 * preview-panel.ts's existing file-saved / reload-settled signals. Renderer-only; capture is a
 * no-op (returns null, pair still finalizes with a missing side) when there's no
 * `window.minnow.preview` capture API — e.g. the browser (npm start) fallback without Electron.
 */
import { createBeforeAfterPairing, type BeforeAfterCapture, type BeforeAfterPair } from './before-after';
import { DEFAULT_DIFF_HISTORY_LIMIT, loadDesignMeta } from '../config/design-meta';
import { pollPreviewGuestUntilIdle } from '../ui/preview-capture-ready';

async function captureViewport(): Promise<BeforeAfterCapture | null> {
  const preview = window.minnow?.preview;
  if (!preview?.capturePage) return null;
  try {
    await pollPreviewGuestUntilIdle(() => preview.getInfo?.());
    const base64 = await preview.capturePage();
    if (!base64) return null;
    return { dataUrl: `data:image/png;base64,${base64}`, capturedAt: Date.now() };
  } catch {
    return null;
  }
}

type PairingController = ReturnType<typeof createBeforeAfterPairing>;
let controller: PairingController | null = null;
let controllerPromise: Promise<PairingController> | null = null;

async function getController(): Promise<PairingController> {
  if (controller) return controller;
  if (controllerPromise) return controllerPromise;
  controllerPromise = (async (): Promise<PairingController> => {
    const meta = await loadDesignMeta().catch(() => null);
    const historyLimit = meta?.diffHistoryLimit ?? DEFAULT_DIFF_HISTORY_LIMIT;
    controller = createBeforeAfterPairing(() => captureViewport(), () => captureViewport(), {
      historyLimit,
    });
    controllerPromise = null;
    return controller;
  })();
  return controllerPromise;
}

export type BeforeAfterPairListener = (chatId: string, pair: BeforeAfterPair) => void;
const listeners = new Set<BeforeAfterPairListener>();

/** Subscribe to newly finalized pairs (e.g. to re-render the transcript for that chat). */
export function onBeforeAfterPair(listener: BeforeAfterPairListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A design-linked file was saved for `chatId`/`turnId` — captures "before" immediately. */
export async function notifyDesignFileSaved(chatId: string, turnId: string, path: string): Promise<void> {
  const c = await getController();
  await c.notifyFileSaved(chatId, turnId, path);
}

/** The post-save auto-reload settled — captures "after", finalizes the pair, notifies listeners. */
export async function notifyDesignReloadSettled(chatId: string): Promise<void> {
  const c = await getController();
  const pair = await c.notifyReloadSettled(chatId);
  if (!pair) return;
  for (const listener of listeners) listener(chatId, pair);
}

/** Finalized pairs for a chat, oldest first (empty until the controller has been touched). */
export function getBeforeAfterPairs(chatId: string): BeforeAfterPair[] {
  return controller?.getPairs(chatId) ?? [];
}

/** Test helper — drop the singleton controller and listeners between cases. */
export function resetBeforeAfterIntegrationForTests(): void {
  controller = null;
  controllerPromise = null;
  listeners.clear();
}
