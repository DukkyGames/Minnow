/**
 * Stream lifecycle hooks for Expert Lab timeline UI (invoked from the tool loop).
 */

export type ExpertLabStreamListener = {
  onRunStart?: (chatId: string) => void;
  onFirstToken?: (chatId: string) => void;
  onPartialText?: (chatId: string, text: string) => void;
  onToolRound?: (chatId: string, toolName: string) => void;
  onRunEnd?: (chatId: string, finalText: string) => void;
  onRunError?: (chatId: string, message: string) => void;
};

let listener: ExpertLabStreamListener | null = null;

export function setExpertLabStreamListener(next: ExpertLabStreamListener | null): void {
  listener = next;
}

export function notifyExpertLabRunStart(chatId: string): void {
  listener?.onRunStart?.(chatId);
}

export function notifyExpertLabFirstToken(chatId: string): void {
  listener?.onFirstToken?.(chatId);
}

export function notifyExpertLabPartialText(chatId: string, text: string): void {
  listener?.onPartialText?.(chatId, text);
}

export function notifyExpertLabToolRound(chatId: string, toolName: string): void {
  listener?.onToolRound?.(chatId, toolName);
}

export function notifyExpertLabRunEnd(chatId: string, finalText: string): void {
  listener?.onRunEnd?.(chatId, finalText);
}

export function notifyExpertLabRunError(chatId: string, message: string): void {
  listener?.onRunError?.(chatId, message);
}
