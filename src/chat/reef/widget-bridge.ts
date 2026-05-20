/**
 * Host-side bridge: postMessage from reef widget iframes → composer / LLM / links.
 */

import { tryNonStreamingFallback } from '../../api/chat.ts';
import { getActiveChat } from '../../state/sessions.ts';
import type { ApiMessage } from '../../types.ts';
import { resolveWidgetLlmBinding, runWidgetCompletion } from './run-widget-completion.ts';
import { subscribeThemeChanges } from './theme-forward.ts';

const MAX_CONCURRENT_LLM = 2;
const DEFAULT_WIDGET_HEIGHT_PX = 120;

interface ReefWidgetHostRecord {
  host: HTMLElement;
  iframe: HTMLIFrameElement;
  setSrcdoc: (html: string) => void;
  widgetHtml: string;
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
}

const hostsByWidgetId = new Map<string, ReefWidgetHostRecord>();
const abortByRequestId = new Map<string, AbortController>();
let activeLlmCount = 0;
let bridgeInitialized = false;
let themeUnsubscribe: (() => void) | null = null;

/** Track mounted host for resize / theme refresh / LLM replies. */
export function registerReefWidgetHost(
  widgetId: string,
  host: HTMLElement,
  iframe: HTMLIFrameElement,
  setSrcdoc: (html: string) => void,
  widgetHtml = '',
): void {
  hostsByWidgetId.set(widgetId, { host, iframe, setSrcdoc, widgetHtml });
}

function isAllowedReefOrigin(origin: string): boolean {
  if (!origin || origin === 'null') return true;
  return origin === window.location.origin;
}

function postToWidget(widgetId: string, payload: ReefPostMessage): void {
  const record = hostsByWidgetId.get(widgetId);
  if (!record?.iframe.contentWindow) return;
  record.iframe.contentWindow.postMessage(payload, '*');
}

function applyWidgetHeight(widgetId: string, heightPx: number): void {
  const record = hostsByWidgetId.get(widgetId);
  if (!record) return;
  const h = Math.max(DEFAULT_WIDGET_HEIGHT_PX, Math.ceil(heightPx));
  record.host.style.height = `${h}px`;
  record.iframe.style.height = `${h}px`;
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
  const messages = Array.isArray(data.messages) ? data.messages : [];
  void runWidgetCompletionForBridge(widgetId, requestId, messages, data.model);
}

function onReefMessage(event: MessageEvent): void {
  if (!isAllowedReefOrigin(event.origin)) return;

  const data = event.data as ReefPostMessage | null;
  if (!data || data.type !== 'reef' || !data.action || !data.widgetId) return;
  if (!hostsByWidgetId.has(data.widgetId)) return;

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
