/**
 * Persisted transcript rows for Brain / code-map prompt injection (UI-only).
 */

import type { Chat, ContextNoticeMessage, InjectionNoticeMessage, Message, PromptInjectionKind } from '../../types';

/** Max stored payload size for injection notice bodies (persistence). */
const INJECTION_BODY_MAX_CHARS = 24_000;

export interface PromptInjectionBlocks {
  brainNotes: string | null;
  codeMap: string | null;
  contextDocuments: string | null;
}

export function injectionNoticeLabel(kind: PromptInjectionKind): string {
  switch (kind) {
    case 'brain-notes':
      return 'Brain notes injected…';
    case 'code-map':
      return 'Code map injected…';
    case 'context-documents':
      return 'Context documents injected…';
    default:
      return 'Context injected…';
  }
}

/** Primary label for the injection transcript row (tool-call action column). */
export function injectionNoticeAction(kind: PromptInjectionKind): string {
  switch (kind) {
    case 'brain-notes':
      return 'Brain notes';
    case 'code-map':
      return 'Code map';
    case 'context-documents':
      return 'Context documents';
    default:
      return 'Context';
  }
}

/** Bench-style outcome text for the injection transcript row. */
export function injectionNoticeOutcome(body?: string): string {
  const trimmed = body?.trim();
  if (!trimmed) return 'Injected';
  const lines = trimmed.split('\n').length;
  return lines === 1 ? '1 line' : `${lines} lines`;
}

export function isUiOnlyTranscriptRole(role: Message['role']): boolean {
  return role === 'context' || role === 'injection';
}

export function isUiOnlyTranscriptMessage(
  msg: Message,
): msg is ContextNoticeMessage | InjectionNoticeMessage {
  return isUiOnlyTranscriptRole(msg.role);
}

export function isInjectionNoticeMessage(msg: Message): msg is InjectionNoticeMessage {
  return msg.role === 'injection';
}

function boundInjectionBody(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= INJECTION_BODY_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, INJECTION_BODY_MAX_CHARS)}\n\n[… truncated for transcript storage]`;
}

function shouldAppendInjection(
  chat: Chat,
  kind: PromptInjectionKind,
  body: string,
): boolean {
  const last = chat.history[chat.history.length - 1];
  if (
    last &&
    last.role === 'injection' &&
    last.kind === kind &&
    last.body === body
  ) {
    return false;
  }
  return true;
}

/**
 * Append 0–2 injection notice rows after the user message for this send.
 */
export function appendInjectionNoticesForTurn(
  chat: Chat,
  blocks: PromptInjectionBlocks,
): InjectionNoticeMessage[] {
  const added: InjectionNoticeMessage[] = [];
  const candidates: Array<{ kind: PromptInjectionKind; raw: string | null }> = [
    { kind: 'brain-notes', raw: blocks.brainNotes },
    { kind: 'code-map', raw: blocks.codeMap },
    { kind: 'context-documents', raw: blocks.contextDocuments },
  ];

  for (const { kind, raw } of candidates) {
    if (!raw?.trim()) continue;
    const body = boundInjectionBody(raw);
    if (!shouldAppendInjection(chat, kind, body)) continue;
    const notice: InjectionNoticeMessage = {
      role: 'injection',
      kind,
      body,
      createdAt: Date.now(),
    };
    chat.history.push(notice);
    added.push(notice);
  }

  return added;
}
