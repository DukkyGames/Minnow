/**
 * Strip `image_url` content parts from an outbound request.
 *
 * Used as the recovery half of Minnow's optimistic vision bet: attached pixels
 * go out to any model not proven text-only, and a rejection is answered by
 * resending the same turn without them rather than failing the user's message.
 */

import type { ApiMessage, ApiMessageContent, ContentPart } from '../types';

/** Replaces dropped pixels so the model knows an image existed and was withheld. */
export const IMAGE_PART_STRIPPED_NOTE =
  '[image omitted — this model rejected image input]';

/** True when any message carries at least one `image_url` part. */
export function messagesHaveImageParts(messages: readonly ApiMessage[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((part) => part.type === 'image_url'),
  );
}

/** Flatten one message's content to text, noting each removed image. */
function contentWithoutImages(content: ApiMessageContent): ApiMessageContent {
  if (!Array.isArray(content)) return content;
  const kept: ContentPart[] = [];
  let removed = 0;
  for (const part of content) {
    if (part.type === 'image_url') {
      removed += 1;
      continue;
    }
    kept.push(part);
  }
  if (removed === 0) return content;
  const text = kept
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n\n');
  const notes = Array.from({ length: removed }, () => IMAGE_PART_STRIPPED_NOTE).join('\n');
  return [text, notes].filter(Boolean).join('\n\n');
}

/**
 * Copy of `messages` with every image part replaced by a short note.
 * Drops tool-screenshot follow-up rows entirely — those carry nothing but the
 * pixels, so a text-only copy would just be noise before the next tool call.
 */
export function messagesWithoutImageParts(messages: readonly ApiMessage[]): ApiMessage[] {
  const out: ApiMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user' && m.toolImageFollowUp) continue;
    if (!Array.isArray(m.content)) {
      out.push(m);
      continue;
    }
    out.push({ ...m, content: contentWithoutImages(m.content) } as ApiMessage);
  }
  return out;
}

/** Body-level wrapper: true when the request would send pixels. */
export function bodyHasImageParts(body: { messages: ApiMessage[] }): boolean {
  return messagesHaveImageParts(body.messages);
}

/** Body-level wrapper: same request with every image part removed. */
export function stripImagePartsFromBody<T extends { messages: ApiMessage[] }>(body: T): T {
  return { ...body, messages: messagesWithoutImageParts(body.messages) };
}
