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

type StreamChoiceSlice = {
  delta?: { content?: unknown };
  message?: { content?: unknown };
};

/**
 * Merge streaming assistant `content` (string fragments or indexed part arrays).
 * Handles providers that send cumulative text on the same part index.
 */
export class StreamingContentAccumulator {
  private readonly parts = new Map<number, string>();

  /** Apply one SSE choice's delta or message content. */
  ingestChoice(choice: StreamChoiceSlice | undefined): void {
    if (!choice) return;
    if (choice.delta?.content !== undefined && choice.delta.content !== null) {
      this.ingestContent(choice.delta.content);
      return;
    }
    if (choice.message?.content !== undefined && choice.message.content !== null) {
      this.ingestContent(choice.message.content);
    }
  }

  /** Join merged parts in index order. */
  getText(): string {
    const indices = [...this.parts.keys()].sort((a, b) => a - b);
    return indices.map((i) => this.parts.get(i) ?? '').join('');
  }

  private ingestContent(raw: unknown): void {
    if (raw == null) return;
    if (typeof raw === 'string') {
      this.appendToPart(0, raw);
      return;
    }
    if (Array.isArray(raw)) {
      for (const item of raw) {
        this.ingestPartItem(item);
      }
      return;
    }
    this.ingestPartItem(raw);
  }

  private ingestPartItem(item: unknown): void {
    if (item == null) return;
    if (typeof item === 'string') {
      this.appendToPart(0, item);
      return;
    }
    if (typeof item !== 'object') return;

    const part = item as Record<string, unknown>;
    const index = typeof part.index === 'number' ? part.index : 0;
    const text = streamDeltaContentToText(part);
    if (!text) return;

    const prev = this.parts.get(index) ?? '';
    if (text.startsWith(prev) && text.length > prev.length) {
      this.parts.set(index, text);
      return;
    }
    if (prev.startsWith(text)) {
      return;
    }
    this.appendToPart(index, text);
  }

  private appendToPart(index: number, text: string): void {
    this.parts.set(index, (this.parts.get(index) ?? '') + text);
  }
}
