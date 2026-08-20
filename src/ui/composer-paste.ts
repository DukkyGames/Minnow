/**
 * Composer clipboard paste: screenshots and copied image files → attachments.
 *
 * A screenshot on the clipboard arrives as an unnamed `File` on the paste event,
 * which the browser will not turn into anything by itself — without this the
 * paste is simply swallowed and the composer stays empty.
 */

import { addAttachments } from '../attachments/store';

/** Clipboard images are nameless blobs; give them a stable, sortable filename. */
function nameForPastedImage(file: File, index: number): string {
  const existing = file.name?.trim();
  // Chromium hands screenshots over as the literal "image.png" for every paste,
  // which would make three pastes in a row indistinguishable in the chip strip.
  if (existing && existing !== 'image.png' && existing !== 'blob') return existing;
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '-')
    .slice(0, 19);
  const ext = (file.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
  const suffix = index > 0 ? `-${index + 1}` : '';
  return `pasted-${stamp}${suffix}.${ext}`;
}

/** Image files on a clipboard payload, renamed for the attachment chip. */
export function imageFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const raw: File[] = [];

  // Prefer DataTransferItemList — it is the canonical paste API. Chromium and
  // Electron mirror the same blob into `.files` as a second File instance, so
  // merging both lists without deduping produces duplicate attachment chips.
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) raw.push(file);
  }

  // Some hosts only expose clipboard files on `.files` (no items list).
  if (raw.length === 0) {
    for (const file of Array.from(data.files ?? [])) {
      if (file.type.startsWith('image/')) raw.push(file);
    }
  }

  return raw.map((file, index) =>
    new File([file], nameForPastedImage(file, index), { type: file.type }),
  );
}

/**
 * True when this paste is *only* an image — pasting a copied cell from a
 * spreadsheet or a rich snippet carries both `text/plain` and an image preview,
 * and the user means the text in that case.
 */
export function pasteIsImageOnly(data: DataTransfer | null): boolean {
  if (!data) return false;
  const text = data.getData('text/plain');
  return !text.trim();
}

/** Composer textareas across the Code, Chat app, email, and desktop surfaces. */
const COMPOSER_INPUT_IDS = new Set([
  'msgInput',
  'chatAppInput',
  'emailAssistantInput',
  'desktopInput',
]);

/** True when the paste landed in a chat composer (not an issue body or a code editor). */
export function isComposerPasteTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const input = target instanceof HTMLTextAreaElement ? target : target.closest('textarea');
  return input instanceof HTMLTextAreaElement && COMPOSER_INPUT_IDS.has(input.id);
}

function onComposerPaste(event: ClipboardEvent): void {
  if (!isComposerPasteTarget(event.target)) return;
  const data = event.clipboardData;
  if (!pasteIsImageOnly(data)) return;
  const files = imageFilesFromClipboard(data);
  if (!files.length) return;
  // Only now: an unhandled paste must still reach the textarea normally.
  event.preventDefault();
  void addAttachments(files);
}

let bound = false;

/**
 * Wires paste-to-attach for every composer surface.
 *
 * Delegated from the document rather than bound per textarea: the Chat app and
 * desktop composers are mounted long after boot, and a per-element binding would
 * silently miss whichever surface had not rendered yet.
 */
export function initComposerPaste(): void {
  if (bound) return;
  bound = true;
  document.addEventListener('paste', onComposerPaste);
}
