/**
 * Compose attachment tray — file picker, drag-and-drop, and the chip row.
 *
 * Files are held in memory as base64 until send: the compose payload is JSON,
 * and a draft autosave deliberately stores only the metadata, so a large deck
 * is never rewritten to disk on every keystroke.
 */

import { fileToAttachment } from '../../email/client-drafts';

/** Mirrors MAX_OUTGOING_ATTACHMENT_BYTES in server/email/smtp.js. */
export const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

export interface PendingAttachment {
  filename: string;
  contentType: string;
  /** Base64, without the data: URL prefix. */
  content: string;
  size: number;
}

export interface AttachmentTrayHandle {
  root: HTMLElement;
  /** Payloads in the shape the send route expects. */
  getAttachments(): PendingAttachment[];
  /** Total bytes staged, for the size guard and the "attach" affordance. */
  totalBytes(): number;
  addFiles(files: FileList | File[]): Promise<void>;
  clear(): void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function createAttachmentTray(options: {
  onStatus?: (state: 'ok' | 'err', message: string) => void;
  onChange?: () => void;
}): AttachmentTrayHandle {
  const attachments: PendingAttachment[] = [];

  const root = document.createElement('div');
  root.className = 'email-attach-tray';

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.hidden = true;

  const attachBtn = document.createElement('button');
  attachBtn.type = 'button';
  attachBtn.className = 'email-btn email-attach-btn';
  attachBtn.textContent = 'Attach';
  attachBtn.title = 'Attach files';
  attachBtn.addEventListener('click', () => picker.click());

  const chips = document.createElement('div');
  chips.className = 'email-attach-chips';

  root.append(attachBtn, chips, picker);

  const totalBytes = (): number =>
    attachments.reduce((sum, attachment) => sum + attachment.size, 0);

  const paint = (): void => {
    chips.replaceChildren();
    attachments.forEach((attachment, index) => {
      const chip = document.createElement('span');
      chip.className = 'email-attach-chip';

      const label = document.createElement('span');
      label.textContent = `${attachment.filename} (${formatBytes(attachment.size)})`;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'email-attach-chip-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${attachment.filename}`);
      remove.addEventListener('click', () => {
        attachments.splice(index, 1);
        paint();
        options.onChange?.();
      });

      chip.append(label, remove);
      chips.appendChild(chip);
    });
    options.onChange?.();
  };

  const addFiles = async (files: FileList | File[]): Promise<void> => {
    const incoming = Array.from(files);
    if (!incoming.length) return;

    // Check the projected total before reading anything: refusing after a
    // 40MB read has already blocked the UI helps nobody.
    const projected = totalBytes() + incoming.reduce((sum, file) => sum + file.size, 0);
    if (projected > MAX_ATTACHMENT_TOTAL_BYTES) {
      options.onStatus?.(
        'err',
        `Attachments would total ${formatBytes(projected)}; the limit is ${formatBytes(
          MAX_ATTACHMENT_TOTAL_BYTES,
        )}`,
      );
      return;
    }

    try {
      const read = await Promise.all(incoming.map((file) => fileToAttachment(file)));
      attachments.push(...read);
      paint();
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'Could not read the file');
    }
  };

  picker.addEventListener('change', () => {
    void addFiles(picker.files ?? []).then(() => {
      // Reset so re-picking the same file fires `change` again.
      picker.value = '';
    });
  });

  return {
    root,
    getAttachments: () => attachments.map((attachment) => ({ ...attachment })),
    totalBytes,
    addFiles,
    clear() {
      attachments.length = 0;
      paint();
    },
  };
}

/**
 * Wire drop-to-attach on a compose surface.
 * @returns a teardown function
 */
export function enableAttachmentDrop(
  target: HTMLElement,
  tray: AttachmentTrayHandle,
): () => void {
  const over = (event: DragEvent): void => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    target.classList.add('is-drop-target');
  };
  const leave = (): void => target.classList.remove('is-drop-target');
  const drop = (event: DragEvent): void => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    target.classList.remove('is-drop-target');
    void tray.addFiles(event.dataTransfer.files);
  };

  target.addEventListener('dragover', over);
  target.addEventListener('dragleave', leave);
  target.addEventListener('drop', drop);

  return () => {
    target.removeEventListener('dragover', over);
    target.removeEventListener('dragleave', leave);
    target.removeEventListener('drop', drop);
  };
}
