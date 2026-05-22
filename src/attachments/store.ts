/**
 * Pending attachment list and composer preview chips (SA-12).
 * Send path and multimodal API wiring land in SA-13 / SA-15.
 */

import { processFile } from './reader';
import { scheduleContextUsageRefresh } from '../ui/context-usage-ring';
import type { Attachment } from './types';

/** Files queued for the next user message. */
const pendingAttachments: Attachment[] = [];

/** Returns a shallow copy of pending attachments. */
export function getPendingAttachments(): Attachment[] {
  return [...pendingAttachments];
}

/** Clears all pending attachments and refreshes the preview strip. */
export function clearAttachments(): void {
  pendingAttachments.length = 0;
  renderAttachPreview();
}

/** Removes one attachment by id. */
export function removeAttachment(id: string): void {
  const index = pendingAttachments.findIndex((item) => item.id === id);
  if (index < 0) return;
  pendingAttachments.splice(index, 1);
  renderAttachPreview();
}

/** Appends one attachment and refreshes the preview strip. */
export function pushAttachment(attachment: Attachment): void {
  pendingAttachments.push(attachment);
  renderAttachPreview();
}

/** Replaces the pending list (e.g. after workspace refs are resolved on send). */
export function replacePendingAttachments(next: Attachment[]): void {
  pendingAttachments.length = 0;
  pendingAttachments.push(...next);
  renderAttachPreview();
}

/**
 * Processes and appends files from the hidden file input.
 * Oversize and unsupported types become error chips.
 */
export async function addAttachments(files: File[]): Promise<void> {
  if (!files.length) return;

  const results = await Promise.all(files.map((file) => processFile(file)));
  pendingAttachments.push(...results);
  renderAttachPreview();
}

/** Label shown on a preview chip for one attachment. */
function chipLabel(attachment: Attachment): string {
  if (attachment.kind === 'error') {
    return attachment.error ?? attachment.name;
  }
  if (attachment.kind === 'workspace') {
    return attachment.workspacePath ?? attachment.name;
  }
  if (attachment.largeTextWarning) {
    return `${attachment.name} (large file)`;
  }
  return attachment.name;
}

/** Builds one preview chip element. */
function createAttachChip(attachment: Attachment): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'attach-chip';
  chip.dataset.attachmentId = attachment.id;

  if (attachment.kind === 'image') {
    chip.classList.add('attach-chip--image');
    if (attachment.dataUrl) {
      const thumb = document.createElement('img');
      thumb.className = 'attach-chip-thumb';
      thumb.src = attachment.dataUrl;
      thumb.alt = '';
      chip.appendChild(thumb);
    }
  }

  if (attachment.kind === 'workspace') {
    chip.classList.add('attach-chip--workspace');
    chip.title = 'Workspace file — content loads when you send';
  }

  if (attachment.kind === 'error') {
    chip.classList.add('attach-chip--error');
    chip.title = attachment.error ?? 'Attachment error';
  } else if (attachment.largeTextWarning) {
    chip.title = 'File is larger than 32KB; only an excerpt may be sent.';
  }

  const label = document.createElement('span');
  label.className = 'attach-chip-label';
  label.textContent = chipLabel(attachment);
  chip.appendChild(label);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'attach-chip-remove';
  removeBtn.setAttribute('aria-label', `Remove ${attachment.name}`);
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => removeAttachment(attachment.id));
  chip.appendChild(removeBtn);

  return chip;
}

/** Renders chips into #attachPreview when the markup exists (SA-15). */
export function renderAttachPreview(): void {
  const container = document.getElementById('attachPreview');
  if (!container) return;

  container.replaceChildren();

  if (pendingAttachments.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');

  for (const attachment of pendingAttachments) {
    container.appendChild(createAttachChip(attachment));
  }
  scheduleContextUsageRefresh();
}

/** Handles change on the hidden #fileInput (also exposed on window for inline HTML). */
export function onFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement;
  const list = input.files;
  if (!list?.length) return;

  void addAttachments(Array.from(list));
  input.value = '';
}

/**
 * Wires attach button and file input when present in index.html (SA-15).
 * Safe to call before markup exists — no-op until elements are added.
 */
export function initAttachments(): void {
  const fileInput = document.getElementById('fileInput') as HTMLInputElement | null;
  const attachBtn = document.getElementById('attachBtn');

  if (fileInput) {
    fileInput.addEventListener('change', onFileSelected);
  }

  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
  }

  renderAttachPreview();
}
