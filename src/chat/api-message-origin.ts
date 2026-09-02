import type { ApiMessage } from '../types';

const historyIndexByMessage = new WeakMap<object, number>();

/** Record the history row an outbound message was built from. */
export function tagApiMessageHistoryIndex(message: ApiMessage, historyIndex: number): void {
  if (historyIndex < 0) return;
  historyIndexByMessage.set(message as object, historyIndex);
}

export function historyIndexOfApiMessage(message: ApiMessage): number | undefined {
  return historyIndexByMessage.get(message as object);
}
