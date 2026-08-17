/**
 * Attachments section of the issue peek panel.
 *
 * Three ways in, because a screenshot arrives by whichever is nearest: the
 * button, a paste into the panel, or a drop onto it. Images render as thumbnails
 * because a bug report with a screenshot you have to click to see is a bug
 * report you do not read.
 *
 * Phase 2 of `documentation/plans/issues-app-v2.md`.
 */

import {
  addIssueAttachment,
  removeIssueAttachment,
  scheduleSaveIssues,
} from '../state/issues-store';
import {
  deleteIssueAttachmentBytes,
  formatAttachmentSize,
  isImageAttachment,
  issueAttachmentUrl,
  uploadIssueAttachment,
} from '../state/issue-attachments-api';
import type { IssueAttachment, IssueCard } from '../types';
import { appConfirm } from './app-dialog';
import { showToast } from './toast';

/** Called after any change so the panel re-renders from store state. */
export type AttachmentsChanged = () => void;

async function ingestFiles(
  issueId: string,
  files: File[],
  onChanged: AttachmentsChanged,
): Promise<void> {
  if (files.length === 0) return;
  let added = 0;
  for (const file of files) {
    try {
      const stored = await uploadIssueAttachment(issueId, file);
      if (!stored) {
        showToast('Attachments need the local server.', 'error');
        return;
      }
      addIssueAttachment(issueId, {
        name: stored.name,
        path: stored.path,
        mime: stored.mime,
        bytes: stored.bytes,
      });
      added += 1;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not attach file', 'error');
    }
  }
  if (added > 0) {
    scheduleSaveIssues();
    showToast(added === 1 ? 'Attached 1 file' : `Attached ${added} files`, 'success');
    onChanged();
  }
}

function filesFromClipboard(event: ClipboardEvent): File[] {
  const items = event.clipboardData?.items;
  if (!items) return [];
  const out: File[] = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}

function buildAttachmentRow(
  issue: IssueCard,
  attachment: IssueAttachment,
  onChanged: AttachmentsChanged,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'issues-attachment';

  if (isImageAttachment(attachment)) {
    const link = document.createElement('a');
    link.className = 'issues-attachment__thumb';
    link.href = issueAttachmentUrl(attachment);
    link.target = '_blank';
    link.rel = 'noreferrer';
    const img = document.createElement('img');
    img.src = issueAttachmentUrl(attachment);
    img.alt = attachment.name;
    img.loading = 'lazy';
    link.appendChild(img);
    row.appendChild(link);
  }

  const meta = document.createElement('div');
  meta.className = 'issues-attachment__meta';

  const name = document.createElement('a');
  name.className = 'issues-attachment__name';
  name.href = issueAttachmentUrl(attachment);
  name.target = '_blank';
  name.rel = 'noreferrer';
  name.textContent = attachment.name;
  meta.appendChild(name);

  const size = formatAttachmentSize(attachment.bytes);
  if (size) {
    const sizeEl = document.createElement('span');
    sizeEl.className = 'issues-attachment__size';
    sizeEl.textContent = size;
    meta.appendChild(sizeEl);
  }

  // The absolute path is what an agent gets handed, so it is visible and
  // copyable rather than hidden behind the link.
  const pathEl = document.createElement('button');
  pathEl.type = 'button';
  pathEl.className = 'issues-attachment__path';
  pathEl.textContent = 'Copy path';
  pathEl.title = attachment.path;
  pathEl.addEventListener('click', () => {
    void navigator.clipboard.writeText(attachment.path).then(
      () => showToast('Copied attachment path', 'success'),
      () => showToast('Could not copy path', 'error'),
    );
  });
  meta.appendChild(pathEl);
  row.appendChild(meta);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'issues-attachment__remove';
  remove.setAttribute('aria-label', `Remove ${attachment.name}`);
  remove.textContent = '×';
  remove.addEventListener('click', () => {
    void (async () => {
      const ok = await appConfirm(`Remove ${attachment.name}? The file is deleted.`, {
        confirmLabel: 'Remove',
        title: 'Remove attachment',
      });
      if (!ok) return;
      await deleteIssueAttachmentBytes(attachment);
      if (removeIssueAttachment(issue.id, attachment.id)) {
        scheduleSaveIssues();
        onChanged();
      }
    })();
  });
  row.appendChild(remove);

  return row;
}

/**
 * Build the section. `body` is the caller's section body so this stays
 * consistent with the panel's other sections rather than inventing chrome.
 */
export function renderIssueAttachments(
  body: HTMLElement,
  issue: IssueCard,
  onChanged: AttachmentsChanged,
): void {
  const attachments = issue.attachments ?? [];

  if (attachments.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'issues-detail__empty';
    empty.textContent = 'Drop a file here, paste a screenshot, or use Attach.';
    body.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'issues-attachments';
    for (const attachment of attachments) {
      list.appendChild(buildAttachmentRow(issue, attachment, onChanged));
    }
    body.appendChild(list);
  }

  const controls = document.createElement('div');
  controls.className = 'issues-detail__add-code';

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.hidden = true;
  picker.addEventListener('change', () => {
    const files = picker.files ? Array.from(picker.files) : [];
    picker.value = '';
    void ingestFiles(issue.id, files, onChanged);
  });

  const attachBtn = document.createElement('button');
  attachBtn.type = 'button';
  attachBtn.className = 'issues-btn';
  attachBtn.textContent = 'Attach…';
  attachBtn.addEventListener('click', () => picker.click());

  controls.append(attachBtn, picker);
  body.appendChild(controls);

  // Paste and drop are bound on the section body, so anywhere in the block
  // works rather than only over the button.
  body.addEventListener('paste', (event) => {
    const files = filesFromClipboard(event as ClipboardEvent);
    if (files.length === 0) return;
    event.preventDefault();
    void ingestFiles(issue.id, files, onChanged);
  });

  body.addEventListener('dragover', (event) => {
    if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    body.classList.add('is-drop-target');
  });
  body.addEventListener('dragleave', () => body.classList.remove('is-drop-target'));
  body.addEventListener('drop', (event) => {
    body.classList.remove('is-drop-target');
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void ingestFiles(issue.id, files, onChanged);
  });
}
