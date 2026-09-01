/**
 * Outbound chat history → provider `messages[]` (VLM parts, image placeholders).
 *
 * P6-D (MIN-726): these helpers used to live beside the client turn loop.
 * They are not a loop — callers compose the payload, then
 * `runTurn()` streams. Do not reintroduce a second SSE/tool loop here.
 */

import { getPendingAttachments } from '../attachments/store';
import type { Attachment } from '../attachments/types';
import {
  attachmentImageDataUrl,
  attachmentsHaveImages,
} from '../attachments/attachment-image';
import { codeRefHistoryBlock, isCodeRefAttachment } from '../attachments/code-ref';
import { elementRefHistoryBlock, isElementRefAttachment } from '../attachments/element-ref';
import { designRefHistoryBlock, isDesignRefAttachment } from '../attachments/design-ref';
import {
  foldLeadingAssistantPreamble,
  repairUnpairedToolCalls,
} from '../api/provider-message-normalize';
import { outboundReasoningReplayFields } from '../api/reasoning';
import { tagApiMessageHistoryIndex } from './api-message-origin';
import { isUiOnlyTranscriptMessage } from './context/injection-notice';
import { copyHistoryForOutboundApi } from './history';
import { indexOfLastUserMessage } from './history-truncate-core';
import {
  TOOL_IMAGE_NO_VISION_HINT,
  toolImageFollowUpUserMessage,
  toolMessageHasImageAttachment,
  USER_IMAGE_NO_VISION_HINT,
} from './tool-image-follow-up';
import { pushOutboundSystemMessages } from '../tools/api-system-messages';
import type {
  ApiMessage,
  ApiMessageContent,
  AssistantMessage,
  AssistantToolCallMessage,
  Chat,
  ContentPart,
  Message,
  UserImageAttachment,
  UserMessage,
} from '../types';

/** Options for {@link buildApiMessages} when the composer has pending files. */
export interface BuildApiMessagesOptions {
  /** Active model id (used to detect VLM for multimodal user content). */
  modelId?: string;
  /**
   * When set, overrides vision detection for screenshot follow-ups and user
   * image parts. Callers that know the catalog pass this (e.g. `runChatTurn`).
   * This module does not import the model catalog — that would pull the runner
   * graph into tests that only serialize attachments.
   */
  vision?: boolean;
  /** Raw user text from the composer for the in-flight turn (not history placeholders). */
  pendingUserText?: string;
  /** Pre-composed system prompt (Step 04); overrides legacy sysPrompt when set. */
  composedSystemPrompt?: string;
  /** Second system message: global user rules (Feature 24). */
  userRulesContent?: string;
  /** Ephemeral user line after an empty post-tool model reply (not stored in history). */
  ephemeralContinueInstruction?: string;
  /** Surface-owned context injected as a system message without persisting in history. */
  ephemeralContext?: string;
  /**
   * Attachments belonging to this turn. Defaults to the composer's pending list only for
   * callers that have not resolved their own set — the running turn always passes its own
   * so the composer strip can be emptied at send time instead of at turn end (MIN-650).
   */
  attachments?: Attachment[];
  /**
   * Replay prior-turn reasoning on plain assistant rows (`features.replayPriorReasoning`).
   * Resolved once per turn by the caller so this stays synchronous.
   */
  replayPriorReasoning?: boolean;
}

/** History placeholder for an image attachment (persisted in UserMessage.content). */
function imageHistoryPlaceholder(name: string): string {
  return `[image: ${name}]`;
}

const IMAGE_PLACEHOLDER_IN_HISTORY_RE = /\[image:\s*[^\]]+\]/i;

/** User row that should receive pending image_url parts (not a later steer line). */
function indexOfMultimodalUserMessage(
  history: Message[],
  pending: Attachment[],
): number {
  const hasPendingImages = attachmentsHaveImages(pending);
  if (!hasPendingImages) {
    return indexOfLastUserMessage(history);
  }
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i];
    if (m.role === 'user' && IMAGE_PLACEHOLDER_IN_HISTORY_RE.test(m.content)) {
      return i;
    }
  }
  return indexOfLastUserMessage(history);
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

/**
 * Non-VLM API payload: one string with text, file blocks, and image placeholders.
 *
 * A bare `[image: shot.png]` reads to the model like a file it should go fetch,
 * so it answers "I don't have an image tool" instead of saying it cannot see.
 * Spell out what actually happened whenever pixels were dropped.
 */
function buildStringUserApiContent(
  userText: string,
  attachments: Attachment[],
): string {
  const content = buildHistoryUserContent(userText, attachments);
  if (!attachmentsHaveImages(attachments)) return content;
  return `${content}${USER_IMAGE_NO_VISION_HINT}`;
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
    const url = attachmentImageDataUrl(att);
    if (!url) continue;
    parts.push({ type: 'image_url', image_url: { url, detail: 'auto' } });
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', text: trimmed || '' });
  }

  return parts;
}

/**
 * Ceiling on image bytes stored per user row. Sessions are one JSON blob, so a
 * handful of 4K screenshots would make every save rewrite tens of megabytes;
 * over the cap the turn still sends the pixels, they just are not persisted.
 */
const MAX_PERSISTED_IMAGE_BYTES = 6 * 1024 * 1024;

/** Composer attachments → the image records stored on the pushed user row. */
export function persistableUserImages(
  attachments: Attachment[],
): UserImageAttachment[] {
  const out: UserImageAttachment[] = [];
  let bytes = 0;
  for (const att of attachments) {
    const dataUrl = attachmentImageDataUrl(att);
    if (!dataUrl?.startsWith('data:image/')) continue;
    bytes += dataUrl.length;
    if (bytes > MAX_PERSISTED_IMAGE_BYTES) break;
    out.push({ name: att.name, dataUrl });
  }
  return out;
}

/**
 * Most recent persisted user images replayed per request. Every replayed image
 * costs its full token price on every later turn, so an old screenshot must not
 * quietly eat the context window for the rest of the chat.
 */
const MAX_REPLAYED_HISTORY_IMAGES = 6;

/**
 * History rows whose persisted images should ride along as `image_url` parts.
 * Walks newest-first so the budget is spent on what the user just asked about,
 * and skips the row that already receives the in-flight composer attachments.
 */
function historyImageReplayIndices(
  history: Message[],
  multimodalUserIdx: number,
): Set<number> {
  const indices = new Set<number>();
  let budget = MAX_REPLAYED_HISTORY_IMAGES;
  for (let i = history.length - 1; i >= 0 && budget > 0; i -= 1) {
    if (i === multimodalUserIdx) continue;
    const m = history[i];
    if (m.role !== 'user') continue;
    const count = m.images?.length ?? 0;
    if (count === 0) continue;
    indices.add(i);
    budget -= count;
  }
  return indices;
}

/** Persisted user row → multimodal content so the model can re-read the pixels. */
function replayUserImageContent(message: UserMessage): ApiMessageContent {
  const parts: ContentPart[] = [];
  if (message.content.trim()) {
    parts.push({ type: 'text', text: message.content });
  }
  for (const image of message.images ?? []) {
    if (!image.dataUrl?.startsWith('data:image/')) continue;
    parts.push({ type: 'image_url', image_url: { url: image.dataUrl, detail: 'auto' } });
  }
  if (parts.length === 0) return message.content;
  return parts;
}

/**
 * Serialize session history for the provider, including tool_calls and tool results.
 * Pending attachments on the last user turn become multimodal API content (VLM) or
 * inlined file blocks; history stays string-only with `[image: …]` placeholders.
 * Tool screenshots keep a string tool result (OpenAI pairing) and, on vision models,
 * a follow-up user message with `image_url` data URLs so the model can see the PNG.
 */
export function buildApiMessages(
  chat: Chat,
  sysPrompt: string,
  options?: BuildApiMessagesOptions,
): ApiMessage[] {
  const messages: ApiMessage[] = [];
  pushOutboundSystemMessages(messages, {
    composedSystemPrompt: options?.composedSystemPrompt,
    legacySysPrompt: sysPrompt,
    userRulesContent: options?.userRulesContent,
  });
  const ephemeralContext = options?.ephemeralContext?.trim();
  if (ephemeralContext) {
    messages.push({ role: 'system', content: ephemeralContext });
  }

  const pending = (options?.attachments ?? getPendingAttachments()).filter(
    (a) => a.kind !== 'error',
  );
  const outboundHistory = copyHistoryForOutboundApi(chat.history);
  const multimodalUserIdx = indexOfMultimodalUserMessage(outboundHistory, pending);
  const modelId = options?.modelId;
  // Tool screenshots stay conservative when the caller did not pass `vision`
  // (unknown catalog → no follow-up pixels). User-attached images get the
  // benefit of the doubt — same split `isVisionModel` / `canSendImagesToModel`
  // had without a catalog row.
  const vlm = options?.vision ?? false;
  const sendUserImages = options?.vision ?? true;
  const replayIndices = sendUserImages
    ? historyImageReplayIndices(outboundHistory, multimodalUserIdx)
    : new Set<number>();

  // Record where each row lands so archive collapse can address history rows by
  // identity instead of guessing at `systemEnd + i` (see api-message-origin.ts).
  const pushFromHistory = (message: ApiMessage, historyIndex: number): void => {
    tagApiMessageHistoryIndex(message, historyIndex);
    messages.push(message);
  };

  for (let i = 0; i < outboundHistory.length; i += 1) {
    const m = outboundHistory[i];
    if (isUiOnlyTranscriptMessage(m)) continue;
    if (m.role === 'user') {
      const isMultimodalUser = i === multimodalUserIdx;
      if (isMultimodalUser && pending.length > 0) {
        const userText = options?.pendingUserText ?? m.content;
        const content: ApiMessageContent = sendUserImages
          ? buildVlmUserApiContent(userText, pending)
          : buildStringUserApiContent(userText, pending);
        pushFromHistory({ role: 'user', content }, i);
      } else if (replayIndices.has(i)) {
        pushFromHistory({ role: 'user', content: replayUserImageContent(m) }, i);
      } else {
        pushFromHistory({ role: 'user', content: m.content }, i);
      }
      continue;
    }

    if (m.role === 'tool') {
      const hasImage = toolMessageHasImageAttachment(m);
      pushFromHistory(
        {
          role: 'tool',
          tool_call_id: m.tool_call_id,
          content:
            hasImage && !vlm ? `${m.content}${TOOL_IMAGE_NO_VISION_HINT}` : m.content,
        },
        i,
      );
      if (vlm) {
        const followUp = toolImageFollowUpUserMessage(m);
        // The follow-up carries no history row of its own; it rides with the tool result.
        if (followUp) messages.push(followUp);
      }
      continue;
    }

    if (m.role === 'assistant') {
      const withTools = m as AssistantToolCallMessage;
      if (withTools.tool_calls?.length) {
        const reasoningText = withTools.thinking?.join('\n\n').trim() ?? '';
        pushFromHistory(
          {
            role: 'assistant',
            content: withTools.content ?? null,
            tool_calls: withTools.tool_calls,
            ...outboundReasoningReplayFields(
              modelId ?? '',
              reasoningText,
              withTools.thinkingSignature,
              { toolCallTurn: true },
            ),
          },
          i,
        );
      } else {
        const reasoningText = options?.replayPriorReasoning
          ? ((m as AssistantMessage).thinking?.join('\n\n').trim() ?? '')
          : '';
        pushFromHistory(
          {
            role: 'assistant',
            content: m.content,
            ...(reasoningText
              ? outboundReasoningReplayFields(modelId ?? '', reasoningText)
              : {}),
          },
          i,
        );
      }
    }
  }

  const continueLine = options?.ephemeralContinueInstruction?.trim();
  if (continueLine) {
    messages.push({ role: 'user', content: continueLine });
  }

  return repairUnpairedToolCalls(foldLeadingAssistantPreamble(messages));
}

/**
 * Persist-aligned prior transcript for `runTurn({ messages })`.
 *
 * Adds no rows of its own (no extra tool-screenshot follow-ups) and drops the
 * same UI-only notice rows `createSessionTranscriptStore().load` drops, so this
 * array and the store's `have` count agree and suffix persist stays aligned.
 * Sending an `injection` / `context` row verbatim fails the completion with
 * HTTP 400 (unknown role), so it cannot ride along just to keep the length.
 * Overlays VLM `image_url` parts onto existing user rows. Inner `runTurn`
 * injects new tool-screenshot follow-ups from `execute` attachments.
 */
export function overlayMultimodalHistoryForRunTurn(
  chat: Chat,
  options?: Pick<
    BuildApiMessagesOptions,
    'modelId' | 'vision' | 'pendingUserText' | 'attachments'
  >,
): Message[] {
  const pending = (options?.attachments ?? getPendingAttachments()).filter(
    (a) => a.kind !== 'error',
  );
  const history = chat.history
    .filter((m) => !isUiOnlyTranscriptMessage(m))
    .map((m) => ({ ...m }));
  const multimodalUserIdx = indexOfMultimodalUserMessage(history, pending);
  const sendUserImages = options?.vision ?? true;
  const replayIndices = sendUserImages
    ? historyImageReplayIndices(history, multimodalUserIdx)
    : new Set<number>();

  for (let i = 0; i < history.length; i += 1) {
    const m = history[i];
    if (m.role !== 'user') continue;
    if (i === multimodalUserIdx && pending.length > 0) {
      const userText = options?.pendingUserText ?? m.content;
      const content: ApiMessageContent = sendUserImages
        ? buildVlmUserApiContent(userText, pending)
        : buildStringUserApiContent(userText, pending);
      (history[i] as unknown as { content: ApiMessageContent }).content = content;
      continue;
    }
    if (replayIndices.has(i)) {
      (history[i] as unknown as { content: ApiMessageContent }).content =
        replayUserImageContent(m);
    }
  }
  return history;
}

/** True when this turn needs VLM overlay (pending files or persisted user images). */
export function chatTurnNeedsMultimodalOverlay(
  chat: Chat,
  attachments: Attachment[],
): boolean {
  if (attachments.some((a) => a.kind !== 'error')) return true;
  for (const m of chat.history) {
    if (m.role === 'user' && (m.images?.length ?? 0) > 0) return true;
  }
  return false;
}
