/**
 * Per-chat main turn activity (phase, tool name, model) for the global agent activity panel.
 */

export type MainTurnPhase = 'generating' | 'tools' | 'thinking';

export interface MainTurnActivity {
  chatId: string;
  phase: MainTurnPhase;
  currentTool: string | null;
  workAgentLabel: string;
  modelId: string;
  providerId: string;
  startedAtMs: number;
}

type MainTurnActivityListener = () => void;

const byChatId = new Map<string, MainTurnActivity>();
const listeners = new Set<MainTurnActivityListener>();

/** Register a listener; returns unsubscribe. */
export function subscribeMainTurnActivity(listener: MainTurnActivityListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** Read-only snapshot of all in-flight main turns. */
export function listMainTurnActivity(): MainTurnActivity[] {
  return [...byChatId.values()];
}

/** Lookup activity for one chat. */
export function getMainTurnActivity(chatId: string): MainTurnActivity | undefined {
  return byChatId.get(chatId);
}

/** Update or insert main-turn activity for a chat. */
export function emitMainTurnActivity(partial: MainTurnActivity): void {
  const existing = byChatId.get(partial.chatId);
  byChatId.set(partial.chatId, {
    chatId: partial.chatId,
    phase: partial.phase,
    currentTool: partial.currentTool ?? null,
    workAgentLabel: partial.workAgentLabel,
    modelId: partial.modelId,
    providerId: partial.providerId,
    startedAtMs: existing?.startedAtMs ?? partial.startedAtMs,
  });
  notify();
}

/** Patch phase/tool without resetting startedAtMs. */
export function patchMainTurnActivity(
  chatId: string,
  patch: Partial<Pick<MainTurnActivity, 'phase' | 'currentTool' | 'workAgentLabel' | 'modelId' | 'providerId'>>,
): void {
  const row = byChatId.get(chatId);
  if (!row) return;
  byChatId.set(chatId, {
    ...row,
    ...patch,
    currentTool: patch.currentTool !== undefined ? patch.currentTool : row.currentTool,
  });
  notify();
}

/** Remove activity when the turn ends. */
export function clearMainTurnActivity(chatId: string): void {
  if (!byChatId.delete(chatId)) return;
  notify();
}

/** Reset store (tests). */
export function resetMainTurnActivity(): void {
  byChatId.clear();
  listeners.clear();
}
