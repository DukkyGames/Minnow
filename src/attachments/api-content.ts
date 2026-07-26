/**
 * Shared user-content builders for composer history + VLM API payloads.
 * Used by the renderer tool loop and the Session Engine (same wire format).
 */

import type { ContentPart } from '../types.ts';
import { codeRefHistoryBlock, isCodeRefAttachment } from './code-ref.ts';
import { designRefHistoryBlock, isDesignRefAttachment } from './design-ref.ts';
import { elementRefHistoryBlock, isElementRefAttachment } from './element-ref.ts';
import type { Attachment } from './types.ts';

/** History placeholder for an image attachment (persisted in UserMessage.content). */
function imageHistoryPlaceholder(name: string): string {
  return `[image: ${name}]`;
}

/** Inline file block for text/PDF content in string user messages. */
function fileContentBlock(name: string, body: string): string {
  const safeName = name.replace(/"/g, "'");
  return `<file name="${safeName}">\n${body}\n</file>`;
}

/** User-visible / persisted content: text, file blocks, and image placeholders. */
export function buildHistoryUserContent(
  userText: string,
  attachments: Attachment[],
): string {
  const parts: string[] = [];
  const trimmed = userText.trim();
  if (trimmed) parts.push(trimmed);

  for (const att of attachments) {
    if (att.kind === 'error') continue;
    if (att.kind === 'image') {
      parts.push(imageHistoryPlaceholder(att.name));
      continue;
    }
    if (isCodeRefAttachment(att)) {
      parts.push(
        codeRefHistoryBlock(
          att.workspacePath,
          att.lineStart,
          att.lineEnd,
          att.text,
        ),
      );
      continue;
    }
    if (isElementRefAttachment(att)) {
      parts.push(
        elementRefHistoryBlock({
          selector: att.selector,
          uid: att.uid ?? null,
          pageUrl: att.pageUrl,
          tagName: att.tagName,
          classList: att.classList,
          rect: att.rect,
          stylesDigest: att.stylesDigest,
          outerHtmlPreview: att.outerHtmlPreview,
          imageName: att.croppedDataUrl ? att.name : undefined,
          sourceMapping: att.sourceMapping,
          accessibleName: att.accessibleName,
          contrastRatio: att.contrastRatio,
          domPath: att.domPath,
          attributes: att.attributes,
          computedStyles: att.computedStyles,
        }),
      );
      if (att.croppedDataUrl) parts.push(imageHistoryPlaceholder(att.name));
      continue;
    }
    if (isDesignRefAttachment(att)) {
      parts.push(
        designRefHistoryBlock({
          shape: att.shape,
          pageUrl: att.pageUrl,
          intentText: att.intentText,
          imageName: att.compositedDataUrl ? att.name : undefined,
        }),
      );
      if (att.compositedDataUrl) parts.push(imageHistoryPlaceholder(att.name));
      continue;
    }
    if ((att.kind === 'text' || att.kind === 'pdf') && att.text) {
      parts.push(fileContentBlock(att.name, att.text));
    }
  }

  return parts.join('\n\n');
}

/** Non-VLM API payload: one string with text, file blocks, and image placeholders. */
export function buildStringUserApiContent(
  userText: string,
  attachments: Attachment[],
): string {
  return buildHistoryUserContent(userText, attachments);
}

/** VLM API payload: text part plus image_url parts (no image placeholders in text). */
export function buildVlmUserApiContent(
  userText: string,
  attachments: Attachment[],
): ContentPart[] {
  const textParts: string[] = [];
  const trimmed = userText.trim();
  if (trimmed) textParts.push(trimmed);

  for (const att of attachments) {
    if (att.kind === 'error' || att.kind === 'image') continue;
    if (isCodeRefAttachment(att)) {
      textParts.push(
        codeRefHistoryBlock(
          att.workspacePath,
          att.lineStart,
          att.lineEnd,
          att.text,
        ),
      );
      continue;
    }
    if (isElementRefAttachment(att)) {
      textParts.push(
        elementRefHistoryBlock({
          selector: att.selector,
          uid: att.uid ?? null,
          pageUrl: att.pageUrl,
          tagName: att.tagName,
          classList: att.classList,
          rect: att.rect,
          stylesDigest: att.stylesDigest,
          outerHtmlPreview: att.outerHtmlPreview,
          imageName: att.croppedDataUrl ? att.name : undefined,
          sourceMapping: att.sourceMapping,
          accessibleName: att.accessibleName,
          contrastRatio: att.contrastRatio,
          domPath: att.domPath,
          attributes: att.attributes,
          computedStyles: att.computedStyles,
        }),
      );
      continue;
    }
    if (isDesignRefAttachment(att)) {
      textParts.push(
        designRefHistoryBlock({
          shape: att.shape,
          pageUrl: att.pageUrl,
          intentText: att.intentText,
          imageName: att.compositedDataUrl ? att.name : undefined,
        }),
      );
      continue;
    }
    if ((att.kind === 'text' || att.kind === 'pdf') && att.text) {
      textParts.push(fileContentBlock(att.name, att.text));
    }
  }

  const parts: ContentPart[] = [];
  const combinedText = textParts.join('\n\n');
  if (combinedText) {
    parts.push({ type: 'text', text: combinedText });
  }

  for (const att of attachments) {
    if (att.kind === 'image' && att.dataUrl) {
      parts.push({
        type: 'image_url',
        image_url: { url: att.dataUrl, detail: 'auto' },
      });
    }
    if (att.kind === 'elementRef' && att.croppedDataUrl) {
      parts.push({
        type: 'image_url',
        image_url: { url: att.croppedDataUrl, detail: 'auto' },
      });
    }
    if (att.kind === 'designRef' && att.compositedDataUrl) {
      parts.push({
        type: 'image_url',
        image_url: { url: att.compositedDataUrl, detail: 'auto' },
      });
    }
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', text: trimmed || '' });
  }

  return parts;
}
