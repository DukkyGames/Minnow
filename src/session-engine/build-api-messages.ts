/**
 * Engine ApiMessage builder — headless history plus optional turn attachments.
 * Reuses loop.ts VLM/history helpers so wire format matches the renderer path.
 */

import {
  buildHistoryUserContent,
  buildVlmUserApiContent,
} from '../attachments/api-content.ts';
import type { Attachment } from '../attachments/types.ts';
import { buildHeadlessApiMessages } from '../headless/build-messages.ts';
import { isVisionModel } from '../providers/vision-model.ts';
import type { ApiMessage, Chat } from '../types.ts';

/** Id heuristic when model cache / sessionState is unavailable under Node. */
const VISION_ID_FALLBACK = /vlm|vision|llava|bakllava|moondream|multimodal/i;

/**
 * Vision detection for the engine loop — tolerates missing sessionState (Node boot).
 * Prefers catalog/cache via {@link isVisionModel}; falls back to model-id regex.
 */
function engineIsVisionModel(modelId: string | undefined): boolean {
  if (!modelId?.trim()) return false;
  try {
    // Empty catalog enables the shared id-regex fallback when cache has no row.
    return isVisionModel(modelId, []);
  } catch {
    return VISION_ID_FALLBACK.test(modelId);
  }
}

export interface BuildEngineApiMessagesOptions {
  /** In-memory attachments for this turn only (not persisted on Chat). */
  turnAttachments?: Attachment[];
  /** Active model id — used for vision / multimodal user content. */
  modelId?: string;
  /** Extra system rules block (parity with headless). */
  userRulesContent?: string | null;
  /**
   * Original user prose for VLM rebuild (without `[image: …]` / `<file>` blocks).
   * History already stores the string form via {@link buildHistoryUserContent}.
   */
  pendingUserText?: string;
}

/** Normalize + cap attachment payloads accepted on `send_message`. */
export function normalizeSendAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  const out: Attachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Attachment;
    if (typeof a.kind !== 'string' || typeof a.name !== 'string') continue;
    if (a.kind === 'error') continue;
    // Keep the renderer Attachment shape; engine only needs kind/name/data/text fields.
    out.push(a);
    if (out.length >= 32) break;
  }
  return out;
}

/**
 * Build history string for a user turn (same format as composer / loop.ts).
 * Thin re-export wrapper so commands.js can import without depending on UI.
 */
export function buildEngineHistoryUserContent(
  userText: string,
  attachments: Attachment[],
): string {
  return buildHistoryUserContent(userText, attachments);
}

/**
 * Serialize chat history for generations — multimodal when turn attachments + VLM.
 */
export function buildEngineApiMessages(
  chat: Chat,
  composedSystemPrompt: string,
  options: BuildEngineApiMessagesOptions = {},
): ApiMessage[] {
  const messages = buildHeadlessApiMessages(
    chat,
    composedSystemPrompt,
    options.userRulesContent,
  );
  const pending = (options.turnAttachments ?? []).filter((a) => a.kind !== 'error');
  if (pending.length === 0) return messages;

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return messages;

  const modelId = options.modelId;
  // Non-VLM: history already has file blocks + image placeholders — leave string as-is.
  if (!engineIsVisionModel(modelId)) return messages;

  const userText = options.pendingUserText ?? '';
  messages[lastUserIdx] = {
    role: 'user',
    content: buildVlmUserApiContent(userText, pending),
  };
  return messages;
}
