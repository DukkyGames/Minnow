/**
 * Conversation rollups for the list pane.
 *
 * The list used to show one row per message, so a ten-message thread filled the
 * screen ten times over and the reader was the only place a conversation
 * existed. A rollup collapses it to a single row: who is in it, how many
 * messages, and the latest snippet.
 *
 * The shaping is pure so it can be tested without a DOM — the rendering that
 * uses it lives in email-layout.ts.
 */

import type { EmailThreadSummary } from '../../email/client';

/** Participants shown before the row falls back to "and N others". */
const MAX_NAMED_PARTICIPANTS = 3;

/**
 * The display name of an address, for a participant list.
 * `Alice Smith <a@x.com>` becomes `Alice`; a bare address keeps its local part.
 */
export function participantLabel(header: string): string {
  const raw = String(header ?? '').trim();
  if (!raw) return '';

  const angled = /^(.*?)<([^>]+)>\s*$/.exec(raw);
  const name = angled ? angled[1].trim().replace(/^["']|["']$/g, '') : '';
  if (name) {
    // First name only: a conversation row has room for people, not full names.
    return name.split(/\s+/)[0];
  }

  const address = angled ? angled[2] : raw;
  return address.split('@')[0] || address;
}

/**
 * Summarize the people in a conversation.
 *
 * Keeps the list short and stable rather than truncating mid-name, because the
 * participant line is the first thing scanned when triaging a full inbox.
 */
export function formatParticipants(participants: string[]): string {
  const names: string[] = [];
  for (const entry of participants) {
    const label = participantLabel(entry);
    if (label && !names.includes(label)) names.push(label);
  }

  if (names.length === 0) return '(unknown)';
  if (names.length <= MAX_NAMED_PARTICIPANTS) return names.join(', ');

  const shown = names.slice(0, MAX_NAMED_PARTICIPANTS).join(', ');
  return `${shown} +${names.length - MAX_NAMED_PARTICIPANTS}`;
}

/** The `×3` chip; single-message threads get no chip at all. */
export function messageCountLabel(count: number): string {
  return count > 1 ? `×${count}` : '';
}

/**
 * Everything a conversation row needs to paint, derived in one place.
 */
export interface ConversationRowModel {
  threadId: string;
  participants: string;
  countLabel: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  unreadCount: number;
  flagged: boolean;
  hasAttachments: boolean;
}

export function toConversationRow(thread: EmailThreadSummary): ConversationRowModel {
  return {
    threadId: thread.threadId,
    participants: formatParticipants(thread.participants ?? []),
    countLabel: messageCountLabel(thread.messageCount ?? 0),
    subject: thread.subject?.trim() || '(no subject)',
    snippet: thread.snippet ?? '',
    date: thread.lastDate ?? '',
    unread: (thread.unreadCount ?? 0) > 0,
    unreadCount: thread.unreadCount ?? 0,
    flagged: Boolean(thread.flagged),
    hasAttachments: Boolean(thread.hasAttachments),
  };
}
