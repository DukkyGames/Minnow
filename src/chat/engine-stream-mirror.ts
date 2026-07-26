/**
 * When MINNOW_SERVER_ENGINE is on, mirror backend generation tokens into the
 * chat DOM without running the renderer tool loop (runChatTurn).
 *
 * Subscribes when chat.currentGenerationId appears via Phase 0 SSE reconcile.
 * Does NOT add the chat to streamingChatIds (that would block remote reconcile).
 */

import { subscribeToGeneration } from '../api/generations';
import { findChatById, getActiveChat, sessionState } from '../state/sessions';
import { isServerEngineEnabled } from '../state/server-engine-flag';
import { isStreamDomVisible } from './streaming-state';
import { appendStreamingAssistantRow, revealAssistantProseBubble } from '../ui/messages';
import { setStatus } from '../ui/status';
import { reportBackgroundError } from '../boot/report-background-error';

/** @type {Map<string, () => void>} */
const unsubscribers = new Map<string, () => void>();
/** Generation ids already mirrored (avoid double-subscribe). */
const mirroredGenerationIds = new Set<string>();

let mirrorInitialized = false;

function teardownMirror(chatId: string): void {
  const unsub = unsubscribers.get(chatId);
  if (unsub) {
    try {
      unsub();
    } catch {
      /* ignore */
    }
    unsubscribers.delete(chatId);
  }
}

/**
 * Start (or refresh) a token mirror for chats with currentGenerationId.
 * Safe to call after every remote session reconcile.
 */
export function syncEngineStreamMirrors(): void {
  if (!isServerEngineEnabled() || !sessionState?.chats) return;

  const activeIds = new Set<string>();
  for (const chat of sessionState.chats) {
    const genId = chat.currentGenerationId?.trim();
    if (!genId || !chat.engineTurnActive) {
      if (unsubscribers.has(chat.id)) teardownMirror(chat.id);
      continue;
    }
    activeIds.add(chat.id);
    if (mirroredGenerationIds.has(genId) && unsubscribers.has(chat.id)) {
      continue;
    }
    teardownMirror(chat.id);
    mirroredGenerationIds.add(genId);
    void startMirror(chat.id, genId);
  }

  for (const chatId of [...unsubscribers.keys()]) {
    if (!activeIds.has(chatId)) teardownMirror(chatId);
  }
}

async function startMirror(chatId: string, generationId: string): Promise<void> {
  const chat = findChatById(chatId);
  if (!chat) return;

  let streamRow: ReturnType<typeof appendStreamingAssistantRow> | null = null;
  let fullText = '';

  if (isStreamDomVisible(chatId)) {
    streamRow = appendStreamingAssistantRow(chatId);
    setStatus('spin', 'Thinking…');
  }

  const unsubscribe = subscribeToGeneration(generationId, {
    onChunk: (chunk) => {
      const choice = chunk.choices?.[0];
      const delta = choice?.delta?.content;
      if (typeof delta === 'string' && delta) {
        fullText += delta;
        if (streamRow?.bubble) {
          streamRow.bubble.textContent = fullText;
          if (streamRow.wrap && streamRow.streamStatus) {
            revealAssistantProseBubble(streamRow.wrap, streamRow.bubble, streamRow.streamStatus);
          }
        }
      }
    },
    onEnd: () => {
      teardownMirror(chatId);
      // Committed history arrives via Phase 0 SSE — no local history push.
      if (getActiveChat().id === chatId) {
        setStatus('ok', '');
      }
    },
    onTransportError: (err) => {
      teardownMirror(chatId);
      reportBackgroundError('engine-stream-mirror', err);
    },
  });

  unsubscribers.set(chatId, unsubscribe);
}

/** Boot the mirror reconciler (idempotent). */
export function initEngineStreamMirror(): void {
  if (mirrorInitialized) return;
  mirrorInitialized = true;
  if (!isServerEngineEnabled()) return;
  syncEngineStreamMirrors();
}

/** @internal */
export function resetEngineStreamMirrorForTests(): void {
  for (const chatId of [...unsubscribers.keys()]) {
    teardownMirror(chatId);
  }
  mirroredGenerationIds.clear();
  mirrorInitialized = false;
}
