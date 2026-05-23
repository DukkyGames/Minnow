/**
 * Host-side bridge: postMessage from reef widget iframes → composer / LLM / links.
 */

import { tryNonStreamingFallback } from '../../api/chat.ts';
import { getActiveChat } from '../../state/sessions.ts';
import {
  emitReefWidgetLlmEnded,
  emitReefWidgetLlmStarted,
} from './activity-events.ts';
import type { ApiMessage } from '../../types.ts';
import { resolveWidgetLlmBinding, runWidgetCompletion } from './run-widget-completion.ts';
import { subscribeThemeChanges } from './theme-forward.ts';
import { createReefWidgetErrorPanel } from './widget-error-ui.ts';
import {
  REEF_WIDGET_MIN_CONTENT_HEIGHT_PX,
  REEF_WIDGET_VALIDATION_TIMEOUT_MS,
  shouldAutoRevealReefWidgetsForTests,
  shouldRunReefWidgetValidationTimeout,
} from './widget-validation.ts';

const MAX_CONCURRENT_LLM = 2;
const DEFAULT_WIDGET_HEIGHT_PX = 120;

export interface ReefWidgetValidationResult {
  ok: boolean;
  errors: string[];
}

interface ReefWidgetHostRecord {
  host: HTMLElement;
  iframe: HTMLIFrameElement;
  setSrcdoc: (html: string) => void;
  widgetHtml: string;
  validationDone: boolean;
  validationErrors: string[];
  lastContentHeightPx: number;
}

interface ReefPostMessage {
  type?: string;
  action?: string;
  widgetId?: string;
  requestId?: string;
  text?: string;
  url?: string;
  height?: number;
  messages?: ApiMessage[];
  model?: string;
  delta?: string;
  error?: string;
  ok?: boolean;
  errors?: string[];
}

const hostsByWidgetId = new Map<string, ReefWidgetHostRecord>();
const abortByRequestId = new Map<string, AbortController>();
const validationTimeoutByWidgetId = new Map<string, ReturnType<typeof setTimeout>>();
let activeLlmCount = 0;
let bridgeInitialized = false;
let themeUnsubscribe: (() => void) | null = null;

function clearReefWidgetValidationTimer(widgetId: string): void {
  const timer = validationTimeoutByWidgetId.get(widgetId);
  if (timer) {
    clearTimeout(timer);
    validationTimeoutByWidgetId.delete(widgetId);
  }
}

function scheduleReefWidgetValidation(widgetId: string): void {
  if (shouldAutoRevealReefWidgetsForTests()) {
    queueMicrotask(() => {
      const record = hostsByWidgetId.get(widgetId);
      if (!record || record.validationDone) return;
      record.lastContentHeightPx = DEFAULT_WIDGET_HEIGHT_PX;
      applyWidgetHeight(widgetId, DEFAULT_WIDGET_HEIGHT_PX);
      completeReefWidgetValidation(widgetId, { ok: true, errors: [] });
    });
    return;
  }

  if (!shouldRunReefWidgetValidationTimeout()) {
    return;
  }

  clearReefWidgetValidationTimer(widgetId);
  const timer = setTimeout(() => {
    validationTimeoutByWidgetId.delete(widgetId);
    completeReefWidgetValidation(widgetId, {
      ok: false,
      errors: ['Widget validation timed out before the iframe reported ready.'],
    });
  }, REEF_WIDGET_VALIDATION_TIMEOUT_MS);
  validationTimeoutByWidgetId.set(widgetId, timer);
}

/** Track mounted host for resize / theme refresh / LLM replies. */
export function registerReefWidgetHost(
  widgetId: string,
  host: HTMLElement,
  iframe: HTMLIFrameElement,
  setSrcdoc: (html: string) => void,
  widgetHtml = '',
): void {
  hostsByWidgetId.set(widgetId, {
    host,
    iframe,
    setSrcdoc,
    widgetHtml,
    validationDone: false,
    validationErrors: [],
    lastContentHeightPx: 0,
  });
  scheduleReefWidgetValidation(widgetId);
}

function revealValidatedWidget(record: ReefWidgetHostRecord): void {
  record.host.classList.remove('reef-widget-host--validating');
  record.host.querySelector('.reef-widget-validating-status')?.remove();
  record.iframe.style.visibility = '';
}

function showWidgetValidationFailure(record: ReefWidgetHostRecord, errors: string[]): void {
  record.host.classList.remove('reef-widget-host--validating');
  record.host.classList.add('reef-widget-host--error');
  record.host.querySelector('.reef-widget-validating-status')?.remove();
  record.iframe.remove();
  record.host.appendChild(createReefWidgetErrorPanel(errors));
}

/** Apply iframe probe result and reveal or show an error panel. */
export function completeReefWidgetValidation(
  widgetId: string,
  result: ReefWidgetValidationResult,
): void {
  const record = hostsByWidgetId.get(widgetId);
  if (!record || record.validationDone) return;

  record.validationDone = true;
  clearReefWidgetValidationTimer(widgetId);

  const mergedErrors = [
    ...record.validationErrors,
    ...(Array.isArray(result.errors) ? result.errors : []),
  ].map((e) => e.trim()).filter(Boolean);

  const heightOk = record.lastContentHeightPx >= REEF_WIDGET_MIN_CONTENT_HEIGHT_PX;
  const ok = result.ok === true && mergedErrors.length === 0 && heightOk;

  if (!ok) {
    const errors = mergedErrors.length > 0 ? mergedErrors : [];
    if (!heightOk) {
      errors.push('Widget did not produce visible content (height too small).');
    }
    showWidgetValidationFailure(record, errors);
    return;
  }

  revealValidatedWidget(record);
}

/** Opaque serialized origin for sandboxed srcdoc reef iframes. */
const REEF_WIDGET_OPAQUE_ORIGIN = 'null';

function isAllowedReefOrigin(origin: string): boolean {
  if (origin === REEF_WIDGET_OPAQUE_ORIGIN) return true;
  const hostOrigin = window.location?.origin ?? '';
  return hostOrigin.length > 0 && origin === hostOrigin;
}

/** Reject confused-deputy posts: source must be the registered iframe for widgetId. */
function isReefMessageFromWidget(widgetId: string, source: MessageEventSource | null): boolean {
  if (!source) return false;
  const record = hostsByWidgetId.get(widgetId);
  const expected = record?.iframe.contentWindow;
  return expected != null && source === expected;
}

function reefWidgetPostMessageTarget(): string {
  return REEF_WIDGET_OPAQUE_ORIGIN;
}

function postToWidget(widgetId: string, payload: ReefPostMessage): void {
  const record = hostsByWidgetId.get(widgetId);
  if (!record?.iframe.contentWindow) return;
  record.iframe.contentWindow.postMessage(payload, reefWidgetPostMessageTarget());
}

function applyWidgetHeight(widgetId: string, heightPx: number): void {
  const record = hostsByWidgetId.get(widgetId);
  if (!record) return;
  const h = Math.max(DEFAULT_WIDGET_HEIGHT_PX, Math.ceil(heightPx));
  record.lastContentHeightPx = h;
  record.host.style.height = `${h}px`;
  record.iframe.style.height = `${h}px`;
}

function recordWidgetRuntimeError(widgetId: string, message: string): void {
  const record = hostsByWidgetId.get(widgetId);
  if (!record) return;
  const trimmed = message.trim();
  if (!trimmed) return;
  if (!record.validationErrors.includes(trimmed)) {
    record.validationErrors.push(trimmed);
  }
}

function handleSendPrompt(text: string): void {
  const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (!input) return;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

function handleOpenLink(url: string): void {
  const trimmed = url.trim();
  if (!trimmed) return;
  const ok = window.confirm(`Open this link in a new tab?\n\n${trimmed}`);
  if (!ok) return;
  window.open(trimmed, '_blank', 'noopener,noreferrer');
}

async function runWidgetCompletionForBridge(
  widgetId: string,
  requestId: string,
  messages: ApiMessage[],
  modelOverride?: string,
): Promise<void> {
  const chat = getActiveChat();
  const binding = await resolveWidgetLlmBinding(chat);
  const modelId = modelOverride?.trim() || binding.modelId;

  const controller = new AbortController();
  abortByRequestId.set(requestId, controller);

  try {
    let fullText = await runWidgetCompletion({
      providerId: binding.providerId,
      modelId,
      messages,
      signal: controller.signal,
      onDelta: (delta) => {
        postToWidget(widgetId, {
          type: 'reef',
          action: 'llmChunk',
          widgetId,
          requestId,
          delta,
        });
      },
    });

    if (!fullText) {
      const fallback = await tryNonStreamingFallback(
        {
          model: modelId || undefined,
          messages,
          temperature: 0.4,
          max_tokens: 2048,
        },
        controller.signal,
        binding.providerId,
      );
      fullText = (fallback.choices?.[0]?.message?.content as string | undefined)?.trim() ?? '';
      if (fullText) {
        postToWidget(widgetId, {
          type: 'reef',
          action: 'llmChunk',
          widgetId,
          requestId,
          delta: fullText,
        });
      }
    }

    postToWidget(widgetId, {
      type: 'reef',
      action: 'llmDone',
      widgetId,
      requestId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'LLM request failed';
    postToWidget(widgetId, {
      type: 'reef',
      action: 'llmError',
      widgetId,
      requestId,
      error: controller.signal.aborted ? 'aborted' : message,
    });
  } finally {
    activeLlmCount = Math.max(0, activeLlmCount - 1);
    abortByRequestId.delete(requestId);
    emitReefWidgetLlmEnded(requestId);
  }
}

function handleCallLLM(data: ReefPostMessage): void {
  const widgetId = data.widgetId;
  const requestId = data.requestId;
  if (!widgetId || !requestId) return;

  if (activeLlmCount >= MAX_CONCURRENT_LLM) {
    postToWidget(widgetId, {
      type: 'reef',
      action: 'llmError',
      widgetId,
      requestId,
      error: 'Too many concurrent widget LLM requests (max 2)',
    });
    return;
  }

  activeLlmCount += 1;
  const chat = getActiveChat();
  void resolveWidgetLlmBinding(chat).then((binding) => {
    const modelId = data.model?.trim() || binding.modelId;
    emitReefWidgetLlmStarted({
      requestId,
      widgetId,
      chatId: chat.id,
      modelId,
      startedAtMs: Date.now(),
    });
  });

  const messages = Array.isArray(data.messages) ? data.messages : [];
  void runWidgetCompletionForBridge(widgetId, requestId, messages, data.model);
}

function onReefMessage(event: MessageEvent): void {
  if (!isAllowedReefOrigin(event.origin)) return;

  const data = event.data as ReefPostMessage | null;
  if (!data || data.type !== 'reef' || !data.action || !data.widgetId) return;
  if (!hostsByWidgetId.has(data.widgetId)) return;
  if (!isReefMessageFromWidget(data.widgetId, event.source)) return;

  switch (data.action) {
    case 'sendPrompt':
      handleSendPrompt(typeof data.text === 'string' ? data.text : '');
      break;
    case 'callLLM':
      handleCallLLM(data);
      break;
    case 'resize':
      if (typeof data.height === 'number') applyWidgetHeight(data.widgetId, data.height);
      break;
    case 'widgetError':
      if (typeof data.error === 'string') recordWidgetRuntimeError(data.widgetId, data.error);
      break;
    case 'validateResult': {
      const errors = Array.isArray(data.errors)
        ? data.errors.filter((e): e is string => typeof e === 'string')
        : [];
      completeReefWidgetValidation(data.widgetId, {
        ok: data.ok === true,
        errors,
      });
      break;
    }
    case 'openLink':
      handleOpenLink(typeof data.url === 'string' ? data.url : '');
      break;
    default:
      break;
  }
}

function refreshAllWidgetThemes(): void {
  for (const [widgetId, record] of hostsByWidgetId) {
    record.setSrcdoc(record.widgetHtml);
    postToWidget(widgetId, { type: 'reef', action: 'themeUpdated', widgetId });
  }
}

/** Wire global message listener and theme subscription (idempotent). */
export function initReefBridge(): void {
  if (bridgeInitialized) return;
  bridgeInitialized = true;

  window.addEventListener('message', onReefMessage);
  themeUnsubscribe = subscribeThemeChanges(() => {
    refreshAllWidgetThemes();
  });
}

/** Tear down all widget hosts in the chat column. */
export function unmountReefWidgetsInChat(): void {
  for (const [, record] of hostsByWidgetId) {
    record.host.remove();
  }
  hostsByWidgetId.clear();

  for (const [, controller] of abortByRequestId) {
    controller.abort();
  }
  abortByRequestId.clear();
  activeLlmCount = 0;

  const area = document.getElementById('chatArea');
  if (!area) return;
  area.querySelectorAll('.reef-widget-host').forEach((el) => el.remove());
}

/** Test-only reset. */
export function resetReefBridgeForTests(): void {
  unmountReefWidgetsInChat();
  for (const timer of validationTimeoutByWidgetId.values()) {
    clearTimeout(timer);
  }
  validationTimeoutByWidgetId.clear();
  if (themeUnsubscribe) {
    themeUnsubscribe();
    themeUnsubscribe = null;
  }
  bridgeInitialized = false;
}

/** Test hook: handle one reef message without window listener. */
export function handleReefMessageForTests(event: MessageEvent): void {
  onReefMessage(event);
}

/** Test hook: expose active LLM count. */
export function getActiveReefLlmCountForTests(): number {
  return activeLlmCount;
}

/** Test hook: seed in-flight count for concurrency gate. */
export function setActiveReefLlmCountForTests(count: number): void {
  activeLlmCount = count;
}

/** Test hook: origin allowlist for reef postMessage. */
export function isAllowedReefOriginForTests(origin: string): boolean {
  return isAllowedReefOrigin(origin);
}
