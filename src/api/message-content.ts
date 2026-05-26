/**
 * Normalize OpenAI-style message `content` (string or multimodal parts) to plain text.
 */

import type { ApiMessageContent, ContentPart } from '../types.ts';

/** Join text parts; non-text parts become short placeholders for estimates / logs. */
export function contentPartsToText(parts: ContentPart[]): string {
  let out = '';
  for (const part of parts) {
    if (part.type === 'text') {
      out += part.text;
      continue;
    }
    if (part.type === 'image_url') {
      out += '[image]';
    }
  }
  return out;
}

/** User/assistant API `content` field → display or token-estimate string. */
export function apiMessageContentToText(content: ApiMessageContent): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return contentPartsToText(content);
  return '';
}

/**
 * Streaming `delta.content` may be a string or structured parts (provider-specific).
 * Always returns a string fragment to append to the completion buffer.
 */
export function streamDeltaContentToText(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    let out = '';
    for (const item of raw) {
      out += streamDeltaContentToText(item);
    }
    return out;
  }
  if (typeof raw === 'object') {
    const part = raw as Record<string, unknown>;
    if (part.type === 'text' && typeof part.text === 'string') {
      return part.text;
    }
    if (typeof part.text === 'string') {
      return part.text;
    }
    if (typeof part.content === 'string') {
      return part.content;
    }
  }
  return '';
}
