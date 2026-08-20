/**
 * Attach screenshot pixels to the outbound API after a tool result.
 *
 * OpenAI-compatible tool messages are string-only, so VLMs never see
 * `/api/browser/screenshot/:id`. A follow-up user message with `image_url`
 * data URLs is the portable way to feed the PNG to the model.
 */

import type {
  ApiMessage,
  ApiUserMessage,
  ContentPart,
  Message,
  ToolImageAttachment,
} from '../types';

/** Text part so the model treats the image as the preceding tool's visual result. */
export const TOOL_IMAGE_FOLLOW_UP_TEXT =
  '[tool screenshot] Visual result of the preceding tool call. Inspect the image; do not fetch the file URL.';

/** Shown on the wire when a screenshot exists but the model is not a VLM. */
export const TOOL_IMAGE_NO_VISION_HINT =
  '\n\n(The screenshot file was saved, but the current model cannot view images. Switch to a vision model to inspect the PNG.)';

/** True when this API user row is an ephemeral screenshot follow-up (not chat history). */
export function isToolImageFollowUpMessage(msg: ApiMessage): boolean {
  return msg.role === 'user' && msg.toolImageFollowUp === true;
}

/** Build a multimodal user follow-up from tool screenshot attachments (data URLs only). */
export function toolImageFollowUpFromAttachments(
  attachments: ToolImageAttachment[] | undefined,
): ApiUserMessage | null {
  if (!attachments?.length) return null;
  const parts: ContentPart[] = [{ type: 'text', text: TOOL_IMAGE_FOLLOW_UP_TEXT }];
  for (const att of attachments) {
    if (att.type !== 'image' || typeof att.dataUrl !== 'string') continue;
    if (!att.dataUrl.startsWith('data:image/')) continue;
    parts.push({
      type: 'image_url',
      image_url: { url: att.dataUrl, detail: 'auto' },
    });
  }
  if (parts.length < 2) return null;
  return { role: 'user', content: parts, toolImageFollowUp: true };
}

/** Follow-up for a persisted tool history row, or null when there are no pixels. */
export function toolImageFollowUpUserMessage(message: Message): ApiUserMessage | null {
  if (message.role !== 'tool') return null;
  return toolImageFollowUpFromAttachments(message.attachments);
}

/** True when a tool row stored at least one screenshot attachment. */
export function toolMessageHasImageAttachment(message: Message): boolean {
  if (message.role !== 'tool' || !message.attachments?.length) return false;
  return message.attachments.some((att) => att.type === 'image');
}

/**
 * Appended to a user message whose attached images could not be sent as pixels.
 * Without it the model sees only `[image: name]` and reports a missing tool.
 */
export const USER_IMAGE_NO_VISION_HINT =
  '\n\n(The user attached the image(s) named above, but the current model cannot accept image input, so the pixels were not sent. There is no tool that can read them — say you cannot see the image and suggest switching to a vision model.)';
