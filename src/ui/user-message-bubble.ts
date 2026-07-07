/**
 * User message bubbles: prose plus clickable file/image chips (MIN-31).
 */

import type { Attachment } from '../attachments/types';
import { formatElementRefLabel } from '../attachments/element-ref-format';
import { parseHistoryUserContent, type HistoryElementRefPart } from '../chat/user-message-parts';
import { stripSkillTagFromHistory } from '../skills/history-content';
import { createCodeRefLinkButton } from './code-ref-link';

/** Optional live attachments when the bubble is painted at send time. */
export interface UserBubbleRenderOptions {
  /** Pending attachments from the composer (includes image data URLs). */
  liveAttachments?: Attachment[];
}

function findLiveImageDataUrl(
  name: string,
  liveAttachments?: Attachment[],
): string | undefined {
  if (!liveAttachments?.length) return undefined;
  const hit = liveAttachments.find((a) => a.kind === 'image' && a.name === name);
  return hit?.dataUrl;
}

function findLiveElementRefDataUrl(
  name: string,
  liveAttachments?: Attachment[],
): string | undefined {
  if (!liveAttachments?.length) return undefined;
  const hit = liveAttachments.find((a) => a.kind === 'elementRef' && a.name === name);
  return hit?.croppedDataUrl;
}

/** Multi-line "open" body for an element-ref chip (selector, styles, outerHTML preview). */
function elementRefSummaryText(ref: HistoryElementRefPart): string {
  const lines: string[] = [
    `Selector: ${ref.selector}`,
    ...(ref.uid != null ? [`data-mn-uid: ${ref.uid}`] : []),
    `Tag: ${ref.tagName}`,
    ...(ref.classList.length ? [`Classes: ${ref.classList.join(' ')}`] : []),
    ...(ref.rect
      ? [
          `Rect: ${Math.round(ref.rect.x)},${Math.round(ref.rect.y)} ${Math.round(ref.rect.width)}×${Math.round(ref.rect.height)}`,
        ]
      : []),
    `Page: ${ref.pageUrl}`,
    `Styles: ${ref.stylesDigest}`,
    '',
    ref.outerHtmlPreview,
  ];
  return lines.join('\n');
}

function openFilePart(name: string, body: string): void {
  void import('./file-viewer').then((m) => {
    m.openAttachmentSnapshotInViewer(name, body);
  });
}

function createMessageAttachChip(
  label: string,
  options: {
    kind: 'file' | 'image';
    dataUrl?: string;
    onOpen: () => void;
  },
): HTMLButtonElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'msg-attach-chip';
  if (options.kind === 'image') {
    chip.classList.add('msg-attach-chip--image');
  } else {
    chip.classList.add('msg-attach-chip--file');
  }
  chip.title = `Open ${label}`;
  chip.setAttribute('aria-label', `Open attachment ${label}`);

  if (options.kind === 'image' && options.dataUrl) {
    const thumb = document.createElement('img');
    thumb.className = 'msg-attach-chip-thumb';
    thumb.src = options.dataUrl;
    thumb.alt = '';
    chip.appendChild(thumb);
  }

  const nameEl = document.createElement('span');
  nameEl.className = 'msg-attach-chip-label';
  nameEl.textContent = label;
  chip.appendChild(nameEl);

  chip.addEventListener('click', () => options.onOpen());
  return chip;
}

/**
 * Paint a user bubble: visible text plus attachment chips (not raw file bodies).
 */
export function renderUserMessageBubble(
  bubble: HTMLDivElement,
  historyContent: string,
  options?: UserBubbleRenderOptions,
): void {
  bubble.replaceChildren();
  bubble.classList.add('msg-bubble--user-parts');

  const displaySource = stripSkillTagFromHistory(historyContent);
  const parsed = parseHistoryUserContent(displaySource);
  const live = options?.liveAttachments;

  if (parsed.text) {
    const textEl = document.createElement('div');
    textEl.className = 'user-msg-text';
    textEl.textContent = parsed.text;
    bubble.appendChild(textEl);
  }

  // The crop for an elementRef is co-emitted as its own `[image: name]` placeholder
  // (same multimodal pipeline as any other image); skip rendering it a second time
  // as a bare image chip once the elementRef chip below already shows it.
  const elementRefImageNames = new Set(
    parsed.elementRefs.map((ref) => ref.imageName).filter((name): name is string => Boolean(name)),
  );
  const visibleImages = parsed.images.filter((image) => !elementRefImageNames.has(image.name));

  const hasChips =
    parsed.files.length > 0 ||
    visibleImages.length > 0 ||
    parsed.codeRefs.length > 0 ||
    parsed.elementRefs.length > 0;
  if (!hasChips) {
    if (!parsed.text) {
      bubble.textContent = displaySource.trim() || historyContent;
      bubble.classList.remove('msg-bubble--user-parts');
    }
    return;
  }

  if (parsed.codeRefs.length > 0) {
    const refsRow = document.createElement('div');
    refsRow.className = 'user-msg-code-refs';
    refsRow.setAttribute('role', 'list');
    for (const ref of parsed.codeRefs) {
      refsRow.appendChild(
        createCodeRefLinkButton({
          workspacePath: ref.workspacePath,
          startLine: ref.startLine,
          endLine: ref.endLine,
        }),
      );
    }
    bubble.appendChild(refsRow);
  }

  const row = document.createElement('div');
  row.className = 'user-msg-attachments';
  row.setAttribute('role', 'list');

  for (const file of parsed.files) {
    row.appendChild(
      createMessageAttachChip(file.name, {
        kind: 'file',
        onOpen: () => openFilePart(file.name, file.body),
      }),
    );
  }

  for (const image of visibleImages) {
    const dataUrl = findLiveImageDataUrl(image.name, live);
    row.appendChild(
      createMessageAttachChip(image.name, {
        kind: 'image',
        dataUrl,
        onOpen: () => {
          if (dataUrl) {
            void import('./file-viewer').then((m) => {
              void m.openImageDataUrlInViewer(image.name, dataUrl);
            });
            return;
          }
          setStatusForMissingImage(image.name);
        },
      }),
    );
  }

  for (const ref of parsed.elementRefs) {
    const label = formatElementRefLabel(ref.selector, ref.pageUrl);
    const dataUrl = ref.imageName ? findLiveElementRefDataUrl(ref.imageName, live) : undefined;
    row.appendChild(
      createMessageAttachChip(label, {
        kind: 'image',
        dataUrl,
        onOpen: () => openFilePart(label, elementRefSummaryText(ref)),
      }),
    );
  }

  if (parsed.files.length > 0 || visibleImages.length > 0 || parsed.elementRefs.length > 0) {
    bubble.appendChild(row);
  }
}

function setStatusForMissingImage(name: string): void {
  void import('./status').then((m) => {
    m.setStatus('err', `Image preview not stored for ${name}`);
  });
}
