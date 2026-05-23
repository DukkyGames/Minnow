/**
 * Pub/sub for in-flight Reef widget LLM requests (agent activity panel).
 */

export interface ReefWidgetLlmActivity {
  requestId: string;
  widgetId: string;
  chatId: string;
  modelId: string;
  startedAtMs: number;
}

type ReefWidgetLlmListener = () => void;

const active = new Map<string, ReefWidgetLlmActivity>();
const listeners = new Set<ReefWidgetLlmListener>();

export function subscribeReefWidgetLlmActivity(listener: ReefWidgetLlmListener): () => void {
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
      /* ignore */
    }
  }
}

export function listReefWidgetLlmActivity(): ReefWidgetLlmActivity[] {
  return [...active.values()];
}

export function emitReefWidgetLlmStarted(row: ReefWidgetLlmActivity): void {
  active.set(row.requestId, row);
  notify();
}

export function emitReefWidgetLlmEnded(requestId: string): void {
  if (!active.delete(requestId)) return;
  notify();
}

export function resetReefWidgetLlmActivity(): void {
  active.clear();
  listeners.clear();
}
