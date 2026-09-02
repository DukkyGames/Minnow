import type { TitleScheduleContext } from './schedule';

export interface TitleJobActivity {
  chatId: string;
  modelId?: string;
  providerId?: string;
  startedAtMs: number;
}

type TitleJobActivityListener = () => void;

const active = new Map<string, TitleJobActivity>();
const listeners = new Set<TitleJobActivityListener>();

export function subscribeTitleJobActivity(listener: TitleJobActivityListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {}
  }
}

export function listTitleJobActivity(): TitleJobActivity[] {
  return [...active.values()];
}

/** Register a title job when inflight registration succeeds. */
export function emitTitleJobStarted(chatId: string, context?: TitleScheduleContext): void {
  active.set(chatId, {
    chatId,
    modelId: context?.modelId,
    providerId: context?.providerId,
    startedAtMs: Date.now(),
  });
  notify();
}

/** Clear when the job finishes or is aborted. */
export function emitTitleJobEnded(chatId: string): void {
  if (!active.delete(chatId)) return;
  notify();
}

export function resetTitleJobActivity(): void {
  active.clear();
  listeners.clear();
}
