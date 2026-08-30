/**
 * Attach screenshot pixels to the outbound API after a tool result.
 *
 * OpenAI-compatible tool messages are string-only, so VLMs never see
 * `/api/browser/screenshot/:id`. A follow-up user message with `image_url`
 * data URLs is the portable way to feed the PNG to the model.
 */
import type { ApiMessage, ApiUserMessage, Message, ToolImageAttachment } from '../../src/types.js';
/** Text part so the model treats the image as the preceding tool's visual result. */
export declare const TOOL_IMAGE_FOLLOW_UP_TEXT = "[tool screenshot] Visual result of the preceding tool call. Inspect the image; do not fetch the file URL.";
/** Shown on the wire when a screenshot exists but the model is not a VLM. */
export declare const TOOL_IMAGE_NO_VISION_HINT = "\n\n(The screenshot file was saved, but the current model cannot view images. Switch to a vision model to inspect the PNG.)";
/** True when this API user row is an ephemeral screenshot follow-up (not chat history). */
export declare function isToolImageFollowUpMessage(msg: ApiMessage): boolean;
/** Build a multimodal user follow-up from tool screenshot attachments (data URLs only). */
export declare function toolImageFollowUpFromAttachments(attachments: ToolImageAttachment[] | undefined): ApiUserMessage | null;
/** Follow-up for a persisted tool history row, or null when there are no pixels. */
export declare function toolImageFollowUpUserMessage(message: Message): ApiUserMessage | null;
/** True when a tool row stored at least one screenshot attachment. */
export declare function toolMessageHasImageAttachment(message: Message): boolean;
/**
 * Appended to a user message whose attached images could not be sent as pixels.
 * Without it the model sees only `[image: name]` and reports a missing tool.
 */
export declare const USER_IMAGE_NO_VISION_HINT = "\n\n(The user attached the image(s) named above, but the current model cannot accept image input, so the pixels were not sent. There is no tool that can read them \u2014 say you cannot see the image and suggest switching to a vision model.)";
