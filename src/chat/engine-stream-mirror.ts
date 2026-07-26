/**
 * When MINNOW_SERVER_ENGINE is on, mirror backend generation tokens into the
 * chat DOM without running the renderer tool loop (runChatTurn).
 *
 * Subscribes when chat.currentGenerationId appears via Phase 0 SSE reconcile.
 * Does NOT add the chat to streamingChatIds (that would block remote reconcile).
 *
 * Mid-turn reload / history re-paint: registers a stream-DOM remount listener so
 * “Generating response…” / “Thinking…” and replayed tokens survive
 * renderChatFromHistory (which wipes live assistant shells).
 */

import { subscribeToGeneration } from '../api/generations';
import { extractStreamDelta } from '../api/chat';
import { extractReasoningDelta, extractReasoningSignatureDelta } from '../api/reasoning';
import { findChatById, getActiveChat, sessionState } from '../state/sessions';
import { isServerEngineEnabled } from '../state/server-engine-flag';
import { isStreamDomVisible } from './streaming-state';
import {
  appendStreamingAssistantRow,
  revealAssistantProseBubble,
  type StreamingAssistantRow,
} from '../ui/messages';
import { ThoughtBubbleController } from '../ui/thought-bubbles';
import { setSidebarStreamPhase } from '../ui/chat-item-dot';
import { registerStreamDomRemount, type StreamDomHandles } from '../tools/stream-chat-dom';
import { setStatus } from '../ui/status';
import { reportBackgroundError } from '../boot/report-background-error';

/** Per-chat live mirror state (tokens + DOM handles). */
interface MirrorState {
  generationId: string;
  fullText: string;
  streamRow: StreamingAssistantRow | null;
  thoughtController: ThoughtBubbleController | null;
  /** Mutable so ThoughtBubble phase callbacks always hit the current row. */
  streamCtx: {
    wrap: HTMLElement | null;
    bubble: HTMLElement | null;
    streamStatus: StreamingAssistantRow['streamStatus'] | null;
  };
  phase: 'generating' | 'thinking' | 'prose';
  unsubscribe: (() => void) | null;
}

/** @type {Map<string, MirrorState>} */
const mirrors = new Map<string, MirrorState>();
/** Generation ids already mirrored (avoid double-subscribe). */
const mirroredGenerationIds = new Set<string>();

let mirrorInitialized = false;

function teardownMirror(chatId: string): void {
  const state = mirrors.get(chatId);
  if (!state) {
    registerStreamDomRemount(chatId, null);
    return;
  }
  if (state.unsubscribe) {
    try {
      state.unsubscribe();
    } catch {
      /* ignore */
    }
  }
  state.thoughtController?.abort();
  registerStreamDomRemount(chatId, null);
  setSidebarStreamPhase(null, chatId);
  mirrors.delete(chatId);
  if (getActiveChat().id === chatId) {
    setStatus('ok', '');
  }
}

/** True when this chat has an active engine token mirror (for DOM remount). */
export function hasEngineStreamMirror(chatId: string): boolean {
  return mirrors.has(chatId);
}

/**
 * Paint (or re-paint) the live assistant shell from accumulated mirror state.
 * Safe after renderChatFromHistory wiped `.msg--awaiting-prose` rows.
 */
function paintMirrorDom(chatId: string, state: MirrorState): void {
  if (!isStreamDomVisible(chatId)) {
    state.streamRow = null;
    state.streamCtx.wrap = null;
    state.streamCtx.bubble = null;
    state.streamCtx.streamStatus = null;
    return;
  }

  const row = appendStreamingAssistantRow(chatId);
  state.streamRow = row;
  state.streamCtx.wrap = row.wrap;
  state.streamCtx.bubble = row.bubble;
  state.streamCtx.streamStatus = row.streamStatus;

  if (!state.thoughtController) {
    state.thoughtController = new ThoughtBubbleController(row.wrap, {
      onThinkingStart: () => {
        state.phase = 'thinking';
        state.streamCtx.streamStatus?.setPhase('thinking');
        setSidebarStreamPhase('thinking', chatId);
        if (getActiveChat().id === chatId) {
          setStatus('spin', 'Thinking…');
        }
      },
      onReasoningEnded: () => {
        if (state.fullText) {
          state.phase = 'prose';
          return;
        }
        state.phase = 'generating';
        state.streamCtx.streamStatus?.setPhase('generating');
        setSidebarStreamPhase('generating', chatId);
        if (getActiveChat().id === chatId) {
          setStatus('spin', 'Generating response…');
        }
      },
    });
  } else {
    state.thoughtController.setAssistantWrap(row.wrap);
    state.thoughtController.ensureLiveStageVisible();
  }

  // Restore stream-status phase after remount (history paint cleared the row).
  if (state.phase === 'thinking') {
    row.streamStatus.setPhase('thinking');
    setSidebarStreamPhase('thinking', chatId);
  } else if (state.phase === 'prose' || state.fullText) {
    // Prose already started — reveal bubble and hide status.
  } else {
    row.streamStatus.setPhase('generating');
    setSidebarStreamPhase('generating', chatId);
  }

  if (state.fullText && row.bubble) {
    row.bubble.textContent = state.fullText;
    revealAssistantProseBubble(row.wrap, row.bubble, row.streamStatus);
    state.phase = 'prose';
  }

  if (getActiveChat().id === chatId) {
    setStatus(
      'spin',
      state.phase === 'thinking' ? 'Thinking…' : 'Generating response…',
    );
  }
}

function onRemount(chatId: string, row: StreamDomHandles): void {
  const state = mirrors.get(chatId);
  if (!state) return;

  state.streamRow = {
    wrap: row.wrap,
    bubble: row.bubble,
    cursor: row.cursor,
    streamStatus: row.streamStatus,
  };
  state.streamCtx.wrap = row.wrap;
  state.streamCtx.bubble = row.bubble;
  state.streamCtx.streamStatus = row.streamStatus;

  state.thoughtController?.setAssistantWrap(row.wrap);
  state.thoughtController?.ensureLiveStageVisible();

  if (state.phase === 'thinking') {
    row.streamStatus.setPhase('thinking');
  } else if (!(state.phase === 'prose' || state.fullText)) {
    row.streamStatus.setPhase('generating');
  }

  if (state.fullText) {
    row.bubble.textContent = state.fullText;
    revealAssistantProseBubble(row.wrap, row.bubble, row.streamStatus);
    state.phase = 'prose';
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
      if (mirrors.has(chat.id)) teardownMirror(chat.id);
      continue;
    }
    activeIds.add(chat.id);
    const existing = mirrors.get(chat.id);
    if (existing && existing.generationId === genId && existing.unsubscribe) {
      // History paint may have wiped the live row — remount if disconnected.
      const wrap = existing.streamRow?.wrap;
      if (!wrap || !wrap.isConnected) {
        paintMirrorDom(chat.id, existing);
      }
      continue;
    }
    teardownMirror(chat.id);
    mirroredGenerationIds.add(genId);
    void startMirror(chat.id, genId);
  }

  for (const chatId of [...mirrors.keys()]) {
    if (!activeIds.has(chatId)) teardownMirror(chatId);
  }
}

async function startMirror(chatId: string, generationId: string): Promise<void> {
  const chat = findChatById(chatId);
  if (!chat) return;

  const state: MirrorState = {
    generationId,
    fullText: '',
    streamRow: null,
    thoughtController: null,
    streamCtx: { wrap: null, bubble: null, streamStatus: null },
    phase: 'generating',
    unsubscribe: null,
  };
  mirrors.set(chatId, state);

  // Remount after switchChat / renderChatFromHistory (engine path skips streamingChatIds).
  registerStreamDomRemount(chatId, (row) => onRemount(chatId, row));

  paintMirrorDom(chatId, state);

  const unsubscribe = subscribeToGeneration(generationId, {
    onChunk: (chunk) => {
      const reasoning = extractReasoningDelta(chunk);
      if (reasoning) {
        state.thoughtController?.appendReasoningDelta(reasoning);
      }
      const reasoningSignature = extractReasoningSignatureDelta(chunk);
      if (reasoningSignature) {
        state.thoughtController?.appendReasoningSignature(reasoningSignature);
      }

      const delta = extractStreamDelta(chunk);
      if (delta) {
        // First prose token ends the live thinking phase (matches loop.ts).
        if (state.phase === 'thinking') {
          state.thoughtController?.endReasoningPhase();
        }
        state.fullText += delta;
        state.phase = 'prose';
        const row = state.streamRow;
        if (row?.bubble && row.wrap?.isConnected) {
          row.bubble.textContent = state.fullText;
          if (row.streamStatus) {
            revealAssistantProseBubble(row.wrap, row.bubble, row.streamStatus);
          }
        } else if (isStreamDomVisible(chatId)) {
          // DOM was wiped mid-stream — remount and paint accumulated text.
          paintMirrorDom(chatId, state);
        }
      }
    },
    onEnd: () => {
      teardownMirror(chatId);
      // Committed history arrives via Phase 0 SSE — no local history push.
    },
    onTransportError: (err) => {
      teardownMirror(chatId);
      reportBackgroundError('engine-stream-mirror', err);
    },
  });

  state.unsubscribe = unsubscribe;
}

/** Boot the mirror reconciler (idempotent). */
export function initEngineStreamMirror(): void {
  if (mirrorInitialized) return;
  mirrorInitialized = true;
  if (!isServerEngineEnabled()) return;
  syncEngineStreamMirrors();
  // Also hydrate any parked ask_question from the current session snapshot.
  void import('./engine-ask-question-mirror').then((m) => m.syncEngineAskQuestionUi());
}

/** @internal */
export function resetEngineStreamMirrorForTests(): void {
  for (const chatId of [...mirrors.keys()]) {
    teardownMirror(chatId);
  }
  mirroredGenerationIds.clear();
  mirrorInitialized = false;
}
