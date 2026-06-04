/**
 * Editor selection → composer code-reference chips (path + line range + snippet).
 */

import { formatCodeRefLabel } from './code-ref-format';
export { codeRefHistoryBlock, formatCodeRefLabel } from './code-ref-format';
import { pushAttachment, getPendingAttachments } from './store';
import type { Attachment } from './types';

function newCodeRefId(): string {
  return `cref-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Queue a selection snippet; dedupes identical path + line range. */
export function addCodeReferenceToComposer(input: {
  workspacePath: string;
  startLine: number;
  endLine: number;
  text: string;
}): void {
  const path = input.workspacePath.trim().replace(/\\/g, '/');
  if (!path || !input.text.trim()) return;

  const startLine = Math.max(1, input.startLine);
  const endLine = Math.max(startLine, input.endLine);

  const duplicate = getPendingAttachments().some(
    (item) =>
      item.kind === 'codeRef' &&
      item.workspacePath === path &&
      item.lineStart === startLine &&
      item.lineEnd === endLine,
  );
  if (duplicate) {
    focusComposerInput();
    return;
  }

  pushAttachment({
    id: newCodeRefId(),
    name: formatCodeRefLabel(path, startLine, endLine),
    kind: 'codeRef',
    mimeType: 'text/plain',
    size: input.text.length,
    text: input.text,
    workspacePath: path,
    lineStart: startLine,
    lineEnd: endLine,
  });
  focusComposerInput();
}

function focusComposerInput(): void {
  document.getElementById('msgInput')?.focus();
}

/** True when attachment is a queued editor code reference. */
export function isCodeRefAttachment(
  attachment: Attachment,
): attachment is Attachment & {
  kind: 'codeRef';
  workspacePath: string;
  lineStart: number;
  lineEnd: number;
  text: string;
} {
  return (
    attachment.kind === 'codeRef' &&
    Boolean(attachment.workspacePath) &&
    typeof attachment.lineStart === 'number' &&
    typeof attachment.lineEnd === 'number' &&
    Boolean(attachment.text)
  );
}
