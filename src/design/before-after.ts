/**
 * Before/after diff pairing (MIN-370 P1): pure pairing state machine for a design-linked chat
 * turn's file saves. A save fires {@link BeforeAfterPairing.notifyFileSaved}, which captures a
 * "before" crop immediately (before the auto-reload the save triggers has a chance to repaint the
 * guest); once the reload settles the caller fires {@link BeforeAfterPairing.notifyReloadSettled},
 * which captures the "after" crop and finalizes the pair into a per-chat ring buffer (oldest
 * evicted once `historyLimit` is exceeded).
 *
 * No DOM/screenshot coupling here — `captureBefore`/`captureAfter` are injected so this is
 * unit-testable without a real preview guest (mirrors region-capture.ts's test-hook pattern, just
 * via constructor injection instead of a module-level hook since this module has per-controller
 * state rather than a singleton).
 */

export interface BeforeAfterCapture {
  dataUrl: string;
  capturedAt: number;
}

/** One paired before/after diff for a design-linked chat turn's file save(s). */
export interface BeforeAfterPair {
  id: string;
  chatId: string;
  turnId: string;
  /** Workspace-relative paths saved during this turn's edit batch (dedupe-ordered, first-seen). */
  paths: string[];
  /** Null when the pre-reload capture failed/was unavailable — the card still shows "after" alone. */
  before: BeforeAfterCapture | null;
  /** Null when the post-reload capture failed/was unavailable. */
  after: BeforeAfterCapture | null;
  createdAt: number;
}

/** Ring-buffer size mirrors config/design-meta.ts's `diffHistoryLimit` default. */
export const DEFAULT_DIFF_HISTORY_LIMIT = 5;

export interface BeforeAfterPairingOptions {
  /** Max pairs retained per chat; oldest evicted first. Default {@link DEFAULT_DIFF_HISTORY_LIMIT}. */
  historyLimit?: number;
  now?: () => number;
  idFactory?: () => string;
}

export interface BeforeAfterPairing {
  /**
   * A file was saved. Starts a new pending pair for (chatId, turnId) — capturing "before"
   * immediately — unless a pair is already pending for the same (chatId, turnId), in which case
   * the path is folded into the same batch (multiple saves before the reload settles share one
   * before/after pair, not one per file). Resolves once the "before" capture has landed.
   */
  notifyFileSaved(chatId: string, turnId: string, path: string): Promise<void>;
  /**
   * The post-save auto-reload has settled. Captures "after" for the chat's pending pair (if any),
   * finalizes it into the ring buffer, and returns it — or null when nothing was pending (e.g. a
   * reload with no preceding tracked save, or `notifyFileSaved` was never called for this chat).
   */
  notifyReloadSettled(chatId: string): Promise<BeforeAfterPair | null>;
  /** All finalized pairs for a chat, oldest first, capped at `historyLimit`. */
  getPairs(chatId: string): BeforeAfterPair[];
  /** True when a pair is mid-flight (before captured, waiting on reload-settled) for this chat. */
  hasPending(chatId: string): boolean;
  reset(): void;
}

interface PendingEntry {
  turnId: string;
  paths: string[];
  beforePromise: Promise<BeforeAfterCapture | null>;
}

let idCounter = 0;
function defaultIdFactory(): string {
  idCounter += 1;
  return `bapair-${Date.now()}-${idCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Build a pairing controller. `captureBefore`/`captureAfter` are the caller's screenshot hooks
 * (region-capture.ts in production); `captureAfter` receives every path saved in the batch since
 * the pair may cover more than one file edit.
 */
export function createBeforeAfterPairing(
  captureBefore: (path: string) => Promise<BeforeAfterCapture | null>,
  captureAfter: (paths: string[]) => Promise<BeforeAfterCapture | null>,
  options?: BeforeAfterPairingOptions,
): BeforeAfterPairing {
  const historyLimit = Math.max(1, options?.historyLimit ?? DEFAULT_DIFF_HISTORY_LIMIT);
  const now = options?.now ?? Date.now;
  const idFactory = options?.idFactory ?? defaultIdFactory;

  const pendingByChat = new Map<string, PendingEntry>();
  const pairsByChat = new Map<string, BeforeAfterPair[]>();

  return {
    async notifyFileSaved(chatId, turnId, path) {
      const existing = pendingByChat.get(chatId);
      if (existing && existing.turnId === turnId) {
        if (!existing.paths.includes(path)) existing.paths.push(path);
        await existing.beforePromise;
        return;
      }
      const beforePromise = captureBefore(path);
      pendingByChat.set(chatId, { turnId, paths: [path], beforePromise });
      await beforePromise;
    },

    async notifyReloadSettled(chatId) {
      const pending = pendingByChat.get(chatId);
      if (!pending) return null;
      pendingByChat.delete(chatId);

      const [before, after] = await Promise.all([
        pending.beforePromise,
        captureAfter([...pending.paths]),
      ]);

      const pair: BeforeAfterPair = {
        id: idFactory(),
        chatId,
        turnId: pending.turnId,
        paths: [...pending.paths],
        before,
        after,
        createdAt: now(),
      };

      const list = pairsByChat.get(chatId) ?? [];
      list.push(pair);
      while (list.length > historyLimit) list.shift();
      pairsByChat.set(chatId, list);

      return pair;
    },

    getPairs(chatId) {
      return [...(pairsByChat.get(chatId) ?? [])];
    },

    hasPending(chatId) {
      return pendingByChat.has(chatId);
    },

    reset() {
      pendingByChat.clear();
      pairsByChat.clear();
    },
  };
}
