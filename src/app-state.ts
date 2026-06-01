import type { LmModelRecord } from './types';

/** Shared mutable app flags (streaming, abort controllers, debounce timers). */

export let streaming = false;

/** Which chat is driving the global streaming flag (sidebar thinking dot). */
export let streamingChatId: string | null = null;

/** Model id → metadata from GET /api/v0/models (used by stats strip). */
export const modelCache = new Map<string, LmModelRecord>();
export let modelsFetchAbort: AbortController | null = null;
export let chatFetchAbort: AbortController | null = null;
export let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Which preset the textarea should match (empty string = Custom). */
export let activeSystemPromptPresetId = '';

/** Avoid re-entrancy when programmatically reverting the preset select after cancel. */
export let suppressSystemPromptSelectChange = false;

/** Debounced assistant markdown render while SSE tokens arrive. */
export let assistantRenderDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/** True while the full-page Expert Lab view covers the chat shell. */
export let expertLabPageOpen = false;

export function setExpertLabPageOpen(value: boolean): void {
  expertLabPageOpen = value;
}

export function setStreaming(value: boolean, chatId?: string | null): void {
  streaming = value;
  if (!value) {
    streamingChatId = null;
    return;
  }
  if (chatId != null && chatId !== '') {
    streamingChatId = chatId;
  } else {
    streamingChatId = null;
  }
}

export function setModelsFetchAbort(controller: AbortController | null): void {
  modelsFetchAbort = controller;
}

export function setChatFetchAbort(controller: AbortController | null): void {
  chatFetchAbort = controller;
}

export function setSaveTimer(timer: ReturnType<typeof setTimeout> | null): void {
  saveTimer = timer;
}

export function setActiveSystemPromptPresetId(id: string): void {
  activeSystemPromptPresetId = id;
}

export function setSuppressSystemPromptSelectChange(value: boolean): void {
  suppressSystemPromptSelectChange = value;
}

export function setAssistantRenderDebounceTimer(
  timer: ReturnType<typeof setTimeout> | null
): void {
  assistantRenderDebounceTimer = timer;
}
