/**
 * Pure helpers for the engine main-chat loop: steer, queue, mode tools.
 * No DOM — mutations apply to Chat / SessionState objects only.
 */

import { randomUUID } from '../lib/random-id';
import { normalizeModeId, type ModeId } from '../chat/modes/types';
import type { Chat, QueuedComposerMessage } from '../types';

const ENGINE_MODE_TOOLS = new Set([
  'set_chat_mode',
  'create_chat_with_mode',
  'propose_mode_switch',
  'check_reef_widget',
]);

const HANDOFF_MODES = new Set<ModeId>([
  'general',
  'desktop',
  'plan',
  'build',
  'orchestrate',
]);

/** True when the tool should run as an engine state mutation. */
export function isEngineModeTool(name: string): boolean {
  return ENGINE_MODE_TOOLS.has(name);
}

/** Move pending steer into history (tool-loop boundary). Returns consumed content. */
export function consumePendingSteerEngine(chat: Chat): string | null {
  const trimmed = chat.pendingSteerMessage?.trim();
  if (!trimmed) return null;
  chat.history.push({ role: 'user', content: trimmed, steer: true });
  chat.pendingSteerMessage = undefined;
  return trimmed;
}

/**
 * Peek the oldest queued follow-up without mutating.
 * Use {@link shiftOldestQueuedMessage} when actually draining.
 */
export function peekOldestQueuedMessage(chat: Chat): string | null {
  const queue = Array.isArray(chat.pendingMessageQueue)
    ? chat.pendingMessageQueue
    : [];
  const text = queue[0]?.text?.trim() ?? '';
  return text || null;
}

/** Pop the oldest queued follow-up text. */
export function shiftOldestQueuedMessage(chat: Chat): string | null {
  const queue = Array.isArray(chat.pendingMessageQueue)
    ? chat.pendingMessageQueue
    : [];
  if (queue.length === 0) return null;
  const item = queue.shift() as QueuedComposerMessage | undefined;
  chat.pendingMessageQueue = queue.length > 0 ? queue : undefined;
  const text = item?.text?.trim() ?? '';
  return text || null;
}

/** Append a follow-up to the queue (test / command helper). */
export function enqueueComposerMessageEngine(chat: Chat, text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (!Array.isArray(chat.pendingMessageQueue)) {
    chat.pendingMessageQueue = [];
  }
  chat.pendingMessageQueue.push({
    id: randomUUID(),
    text: trimmed,
    createdAt: Date.now(),
  });
  return true;
}

/** set_chat_mode — mutate modeId on the chat. */
export function executeSetChatModeEngine(
  args: Record<string, unknown>,
  chat: Chat,
): string {
  const raw =
    typeof args.mode === 'string'
      ? args.mode
      : typeof args.modeId === 'string'
        ? args.modeId
        : '';
  const modeId = normalizeModeId(raw);
  if (!HANDOFF_MODES.has(modeId)) {
    return `Error: unsupported mode "${raw}". Use general, desktop, plan, build, or orchestrate.`;
  }
  chat.modeId = modeId;
  return `Switched this chat to ${modeId} mode.`;
}

/**
 * propose_mode_switch — queue pendingModeId when a target mode is clear;
 * otherwise record a textual hint for the client via an assistant-visible result.
 */
export function executeProposeModeSwitchEngine(
  args: Record<string, unknown>,
  chat: Chat,
): string {
  const situation =
    typeof args.situation === 'string' ? args.situation.trim() : '';
  const explicit =
    typeof args.mode === 'string'
      ? args.mode
      : typeof args.modeId === 'string'
        ? args.modeId
        : '';
  let target: ModeId | null = null;
  if (explicit && HANDOFF_MODES.has(normalizeModeId(explicit))) {
    target = normalizeModeId(explicit);
  } else if (situation === 'implement_in_wrong_mode' || situation === 'plan_complete') {
    target = 'build';
  } else if (situation === 'plan_in_build') {
    target = 'plan';
  }
  if (target) {
    chat.pendingModeId = target;
    return `Proposed switching this chat to ${target} mode (pending user confirmation).`;
  }
  return `Proposed a mode switch${situation ? ` (${situation})` : ''}. Confirm in the UI.`;
}

/** check_reef_widget — no-op stub (Reef lives in the renderer). */
export function executeCheckReefWidgetEngine(): string {
  return 'Reef widget check is not available in the server engine (no-op).';
}

/**
 * create_chat_with_mode — add a sibling chat on the session state.
 */
export function executeCreateChatWithModeEngine(
  args: Record<string, unknown>,
  state: unknown,
  sourceChatId: string,
): string {
  const raw =
    typeof args.mode === 'string'
      ? args.mode
      : typeof args.modeId === 'string'
        ? args.modeId
        : '';
  const modeId = normalizeModeId(raw);
  if (!HANDOFF_MODES.has(modeId)) {
    return `Error: unsupported mode "${raw}".`;
  }
  if (!state || typeof state !== 'object') {
    return 'Error: session state unavailable';
  }
  const session = state as {
    chats?: Chat[];
    activeChatId?: string;
  };
  if (!Array.isArray(session.chats)) session.chats = [];
  const source = session.chats.find((c) => c.id === sourceChatId);
  const now = Date.now();
  const name =
    typeof args.name === 'string' && args.name.trim()
      ? args.name.trim()
      : `${modeId} chat`;
  const newChat: Chat = {
    id: randomUUID(),
    name,
    workspacePath: source?.workspacePath ?? '',
    modelId: source?.modelId ?? '',
    providerId: source?.providerId,
    modeId,
    workAgentAuto: true,
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: now,
  };
  session.chats.push(newChat);
  if (args.activate === true || args.switch === true) {
    session.activeChatId = newChat.id;
  }
  return `Created chat "${name}" (${newChat.id}) in ${modeId} mode.`;
}

/**
 * Execute a mode tool against a single chat (set / propose / reef).
 * create_chat_with_mode must use {@link executeCreateChatWithModeEngine}.
 */
export function executeEngineModeTool(
  name: string,
  args: Record<string, unknown>,
  chat: Chat,
): string {
  if (name === 'set_chat_mode') return executeSetChatModeEngine(args, chat);
  if (name === 'propose_mode_switch') {
    return executeProposeModeSwitchEngine(args, chat);
  }
  if (name === 'check_reef_widget') return executeCheckReefWidgetEngine();
  if (name === 'create_chat_with_mode') {
    return 'Error: create_chat_with_mode requires session-level mutation';
  }
  return `Error: unknown engine mode tool "${name}"`;
}
