/**
 * Board-report follow-up: queue full board context as a normal text file chip.
 * Send inlines it through the existing `<file name="…">` path — no new AttachmentKind.
 */

import { estimateTextByteSize } from './file-card';
import { clearAttachments, pushAttachment } from './store';
import type { Attachment } from './types';

function newBoardRefId(): string {
  return `board-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Focus the Code composer so the user can type after leaving Boards. */
function focusComposerInput(): void {
  document.getElementById('msgInput')?.focus();
}

/**
 * Replace pending chips with one text attachment labeled by the board title.
 * Body is injected on send; composer text is left empty.
 */
export function attachBoardFollowUpChip(input: { name: string; text: string }): Attachment {
  const name = input.name.trim() || 'Board';
  const text = input.text;
  const attachment: Attachment = {
    id: newBoardRefId(),
    name,
    kind: 'text',
    mimeType: 'text/plain',
    size: estimateTextByteSize(text),
    text,
  };
  clearAttachments();
  pushAttachment(attachment);
  focusComposerInput();
  return attachment;
}
