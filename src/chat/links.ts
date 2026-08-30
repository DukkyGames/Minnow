/**
 * Durable file/URL links pinned on a chat (MIN-630).
 *
 * Distinct from this-turn composer attachments: these chips live on the chat
 * row, survive reload, and are listed in the system prompt as standing context.
 */

import type { Chat, ChatLink, ChatLinkKind } from '../types';
import { ensureChatLinks } from '../state/session-schema.mjs';
import { getActiveChat, scheduleSaveSessions, touchChat } from '../state/sessions';

/** Input for pinning a new chat link (id / addedAt filled in). */
export interface ChatLinkDraft {
  kind: ChatLinkKind;
  path?: string;
  url?: string;
  label?: string;
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || path;
}

function hostnameLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function newChatLinkId(): string {
  return `clink-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Build a draft link object before schema normalize. */
function draftChatLink(input: ChatLinkDraft): Record<string, unknown> | null {
  if (input.kind === 'file') {
    const path = (input.path ?? '').trim().replace(/\\/g, '/');
    if (!path) return null;
    return {
      id: newChatLinkId(),
      kind: 'file',
      path,
      label: (input.label ?? '').trim() || basename(path),
      addedAt: Date.now(),
    };
  }
  const url = (input.url ?? '').trim();
  if (!url) return null;
  return {
    id: newChatLinkId(),
    kind: 'url',
    url,
    label: (input.label ?? '').trim() || hostnameLabel(url),
    addedAt: Date.now(),
  };
}

/** Normalized links on a chat (empty array when none). */
export function listChatLinks(chat: Chat | null | undefined): ChatLink[] {
  return chat?.links?.length ? [...chat.links] : [];
}

/**
 * Pin a file or URL on the chat. Dedupes by path/URL. Returns the stored link,
 * or null when the draft was invalid.
 */
export function addChatLink(chat: Chat, input: ChatLinkDraft): ChatLink | null {
  const draft = draftChatLink(input);
  if (!draft) return null;
  const key = input.kind === 'file'
    ? `file:${String(draft.path ?? '')}`
    : `url:${String(draft.url ?? '')}`;
  const existing = (chat.links ?? []).find((link) => chatLinkKey(link) === key);
  if (existing) return existing;
  const next = ensureChatLinks([...(chat.links ?? []), draft]);
  if (!next?.length) return null;
  chat.links = next;
  touchChat(chat);
  scheduleSaveSessions();
  return next.find((link) => chatLinkKey(link) === key) ?? next[next.length - 1] ?? null;
}

/** Pin a link on the active chat and return it. */
export function addChatLinkToActiveChat(input: ChatLinkDraft): ChatLink | null {
  const chat = getActiveChat();
  return addChatLink(chat, input);
}

/** Remove a pinned link by id. Returns true when something was removed. */
export function removeChatLink(chat: Chat, linkId: string): boolean {
  const id = linkId.trim();
  if (!id || !chat.links?.length) return false;
  const next = chat.links.filter((link) => link.id !== id);
  if (next.length === chat.links.length) return false;
  chat.links = next.length ? next : undefined;
  touchChat(chat);
  scheduleSaveSessions();
  return true;
}

/** Identity key used for dedupe (file path or URL). */
export function chatLinkKey(link: ChatLink): string {
  if (link.kind === 'file') return `file:${(link.path ?? '').replace(/\\/g, '/')}`;
  return `url:${link.url ?? ''}`;
}

/**
 * Compact system-prompt block listing pinned files/URLs. Does not dump file
 * bodies — the model can `read_file` / open the URL itself.
 */
export function formatChatLinksPromptBlock(links: ChatLink[] | undefined): string | null {
  if (!links?.length) return null;
  const lines = [
    'The user pinned these links on this chat. Treat them as standing context, not a one-turn attachment. Read files or open URLs when they are relevant:',
  ];
  for (const link of links) {
    if (link.kind === 'file' && link.path) {
      lines.push(`- file: ${link.path}`);
    } else if (link.kind === 'url' && link.url) {
      lines.push(`- url: ${link.url}`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : null;
}
