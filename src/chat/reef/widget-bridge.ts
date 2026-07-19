import { appAlert, appConfirm, appPrompt } from '../../ui/app-dialog';
/**
 * Host-side bridge: postMessage from reef widget iframes → composer / LLM / links.
 */

import { tryNonStreamingFallback } from '../../api/chat.ts';
import { getActiveChat, scheduleSaveSessions } from '../../state/sessions.ts';
import { appendReefArtifactVersion } from './artifact-client.ts';
import { queueReefArtifactUserEdit } from './artifact-context.ts';
import {
  emitReefWidgetLlmEnded,
  emitReefWidgetLlmStarted,
} from './activity-events.ts';
import type { ApiMessage } from '../../types.ts';
import { resolveWidgetLlmBinding, runWidgetCompletion } from './run-widget-completion.ts';
import { recordChatCompletionUsage } from '../../usage/record-chat-usage.ts';
import { hasMeasurableUsage } from '../../usage/pricing.ts';
import { subscribeThemeChanges } from './theme-forward.ts';
import { createReefWidgetErrorPanel } from './widget-error-ui.ts';
import {
  hasExhaustedSilentWidgetRepair,
  tryEnqueueSilentWidgetRepair,
  showSoftFallbackOnHost,
} from './widget-repair.ts';
import {
  REEF_WIDGET_MIN_CONTENT_HEIGHT_PX,
  REEF_WIDGET_VALIDATION_RESIZE_GRACE_MS,
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
  artifactId?: string;
}

export interface ReefArtifactEditPayload {
  artifactId: string;
  content?: string;
  summary?: string;
  widgetId: string;
}

export type ReefArtifactEditListener = (payload: {
  artifactId: string;
  version: number;
  summary: string;
  path: string;
}) => void;

const artifactEditListeners = new Set<ReefArtifactEditListener>();
const artifactEditDebounceByKey = new Map<string, ReturnType<typeof setTimeout>>();
const ARTIFACT_EDIT_DEBOUNCE_MS = 500;

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
  artifactId?: string;
  content?: string;
  summary?: string;
}

const hostsByWidgetId = new Map<string, ReefWidgetHostRecord>();
const abortByRequestId = new Map<string, AbortController>();
const validationTimeoutByWidgetId = new Map<string, ReturnType<typeof setTimeout>>();
const validationResizeGraceByWidgetId = new Map<string, ReturnType<typeof setTimeout>>();
let activeLlmCount = 0;
let bridgeInitialized = false;
let themeUnsubscribe: (() => void) | null = null;

function clearReefWidgetValidationTimer(widgetId: string): void {
  const timer = validationTimeoutByWidgetId.get(widgetId);
  if (timer) {
    clearTimeout(timer);
    validationTimeoutByWidgetId.delete(widgetId);
  }
  const grace = validationResizeGraceByWidgetId.get(widgetId);
  if (grace) {
    clearTimeout(grace);
    validationResizeGraceByWidgetId.delete(widgetId);
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
    const record = hostsByWidgetId.get(widgetId);
    if (!record || record.validationDone) return;

    if (record.validationErrors.length > 0) {
      completeReefWidgetValidation(widgetId, {
        ok: false,
        errors: record.validationErrors.slice(),
      });
      return;
    }

    if (record.lastContentHeightPx >= REEF_WIDGET_MIN_CONTENT_HEIGHT_PX) {
      completeReefWidgetValidation(widgetId, { ok: true, errors: [] });
      return;
    }

    /* Probe postMessage may not reach the host; still reveal at default height. */
    applyWidgetHeight(widgetId, DEFAULT_WIDGET_HEIGHT_PX);
    completeReefWidgetValidation(widgetId, { ok: true, errors: [] });
  }, REEF_WIDGET_VALIDATION_TIMEOUT_MS);
  validationTimeoutByWidgetId.set(widgetId, timer);
}

/** Track mounted host for resize / theme refresh / LLM replies. */
/** Notify UI when an artifact version is written from a widget edit. */
export function subscribeEdits(listener: ReefArtifactEditListener): () => void {
  artifactEditListeners.add(listener);
  return () => {
    artifactEditListeners.delete(listener);
  };
}

export function unsubscribeEdits(listener: ReefArtifactEditListener): void {
  artifactEditListeners.delete(listener);
}

function notifyArtifactEditListeners(payload: {
  artifactId: string;
  version: number;
  summary: string;
  path: string;
}): void {
  for (const listener of artifactEditListeners) {
    listener(payload);
  }
}

function resolveArtifactIdForWidget(
  widgetId: string,
  payloadArtifactId?: string,
): string | undefined {
  const fromPayload = payloadArtifactId?.trim();
  if (fromPayload) return fromPayload;
  const record = hostsByWidgetId.get(widgetId);
  if (record?.artifactId) return record.artifactId;
  const hostAttr = record?.host.dataset.artifactId?.trim();
  return hostAttr || undefined;
}

/** Debounced persist of iframe editArtifact → new artifact version. */
export function editArtifactFromWidget(
  widgetId: string,
  payload: Omit<ReefArtifactEditPayload, 'widgetId'>,
): void {
  const artifactId = resolveArtifactIdForWidget(widgetId, payload.artifactId);
  if (!artifactId) return;
  if (payload.content == null) return;

  const key = `${widgetId}:${artifactId}`;
  const existing = artifactEditDebounceByKey.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    artifactEditDebounceByKey.delete(key);
    void flushArtifactEdit(widgetId, artifactId, payload.content ?? '', payload.summary);
  }, ARTIFACT_EDIT_DEBOUNCE_MS);
  artifactEditDebounceByKey.set(key, timer);
}

async function flushArtifactEdit(
  widgetId: string,
  artifactId: string,
  content: string,
  summary?: string,
): Promise<void> {
  try {
    const result = await appendReefArtifactVersion(artifactId, {
      body: content,
      author: 'user',
      summary,
    });
    const alias = `@minnow/reef/artifacts/${artifactId}`;
    const editSummary = summary?.trim() || `updated to v${result.version}`;

    notifyArtifactEditListeners({
      artifactId,
      version: result.version,
      summary: editSummary,
      path: alias,
    });

    const chat = getActiveChat();
    queueReefArtifactUserEdit(chat, {
      artifactId,
      version: result.version,
      summary: editSummary,
      path: alias,
    });
    scheduleSaveSessions();
    void widgetId;
  } catch {
    /* Host surfaces errors via subscribeEdits consumers in future UI. */
  }
}

export function registerReefWidgetHost(
  widgetId: string,
  host: HTMLElement,
  iframe: HTMLIFrameElement,
  setSrcdoc: (html: string) => void,
  widgetHtml = '',
  artifactId?: string,
): void {
  hostsByWidgetId.set(widgetId, {
    host,
    iframe,
    setSrcdoc,
    widgetHtml,
    validationDone: false,
    validationErrors: [],
    lastContentHeightPx: 0,
    artifactId,
  });
  if (artifactId) {
    host.dataset.artifactId = artifactId;
  }

  if (shouldAutoRevealReefWidgetsForTests()) {
    scheduleReefWidgetValidation(widgetId);
    return;
  }

  let validationArmed = false;
  const armValidationTimeout = (): void => {
    if (validationArmed) return;
    validationArmed = true;
    scheduleReefWidgetValidation(widgetId);
  };

  iframe.addEventListener('load', armValidationTimeout, { once: true });
  queueMicrotask(() => {
    try {
      if (iframe.contentDocument?.readyState === 'complete') {
        armValidationTimeout();
      }
    } catch {
      /* Sandboxed srcdoc: host cannot read the document until load; wait for load event. */
    }
  });
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

    const repairStarted = tryEnqueueSilentWidgetRepair({
      widgetId,
      host: record.host,
      widgetHtml: record.widgetHtml,
      errors,
    });
    if (repairStarted) {
      return;
    }

    record.validationDone = true;

    if (hasExhaustedSilentWidgetRepair(record.host)) {
      showSoftFallbackOnHost(record.host);
      return;
    }

    showWidgetValidationFailure(record, errors);
    return;
  }

  record.validationDone = true;
  revealValidatedWidget(record);
}

/** Opaque serialized origin for sandboxed srcdoc reef iframes. */
const REEF_WIDGET_OPAQUE_ORIGIN = 'null';

function isAllowedReefOrigin(origin: string): boolean {
  if (origin === REEF_WIDGET_OPAQUE_ORIGIN || origin === '') return true;
  const hostOrigin = window.location?.origin ?? '';
  return hostOrigin.length > 0 && origin === hostOrigin;
}

/**
 * Reject confused-deputy posts: source must be the registered iframe for widgetId.
 * Some hosts report `source: null` for sandboxed srcdoc iframes (opaque origin).
 */
function isReefMessageFromWidget(
  widgetId: string,
  source: MessageEventSource | null,
  origin: string,
): boolean {
  if (!hostsByWidgetId.has(widgetId)) return false;
  const record = hostsByWidgetId.get(widgetId);
  const expected = record?.iframe.contentWindow;
  if (expected != null && source === expected) return true;
  if (
    source == null &&
    (origin === REEF_WIDGET_OPAQUE_ORIGIN || origin === '')
  ) {
    return true;
  }
  return false;
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

function finishReefWidgetValidation(
  widgetId: string,
  result: ReefWidgetValidationResult,
): void {
  const record = hostsByWidgetId.get(widgetId);
  if (!record || record.validationDone) return;

  const reportedErrors = Array.isArray(result.errors)
    ? result.errors.map((e) => e.trim()).filter(Boolean)
    : [];
  if (result.ok !== true || reportedErrors.length > 0 || record.validationErrors.length > 0) {
    completeReefWidgetValidation(widgetId, result);
    return;
  }

  if (record.lastContentHeightPx >= REEF_WIDGET_MIN_CONTENT_HEIGHT_PX) {
    completeReefWidgetValidation(widgetId, result);
    return;
  }

  const existing = validationResizeGraceByWidgetId.get(widgetId);
  if (existing) return;

  const grace = setTimeout(() => {
    validationResizeGraceByWidgetId.delete(widgetId);
    const latest = hostsByWidgetId.get(widgetId);
    if (!latest || latest.validationDone) return;
    if (latest.lastContentHeightPx < REEF_WIDGET_MIN_CONTENT_HEIGHT_PX) {
      applyWidgetHeight(widgetId, DEFAULT_WIDGET_HEIGHT_PX);
    }
    completeReefWidgetValidation(widgetId, result);
  }, REEF_WIDGET_VALIDATION_RESIZE_GRACE_MS);
  validationResizeGraceByWidgetId.set(widgetId, grace);
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
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.focus();
}

async function handleOpenLink(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) return;
  const ok = await appConfirm(`Open this link in a new tab?\n\n${trimmed}`);
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
    let completion = await runWidgetCompletion({
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
    let fullText = completion.text;

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
      if (fallback.usage && hasMeasurableUsage(fallback.usage)) {
        completion = { text: fullText, usage: fallback.usage };
      }
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

    if (hasMeasurableUsage(completion.usage)) {
      void recordChatCompletionUsage(chat, {
        source: { kind: 'reef-widget' },
        providerId: binding.providerId,
        modelId,
        usage: completion.usage!,
      });
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
  if (!isReefMessageFromWidget(data.widgetId, event.source, event.origin)) return;

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
      finishReefWidgetValidation(data.widgetId, {
        ok: data.ok === true,
        errors,
      });
      break;
    }
    case 'openLink':
      void handleOpenLink(typeof data.url === 'string' ? data.url : '');
      break;
    case 'editArtifact':
      editArtifactFromWidget(data.widgetId, {
        artifactId: typeof data.artifactId === 'string' ? data.artifactId : '',
        content: typeof data.content === 'string' ? data.content : undefined,
        summary: typeof data.summary === 'string' ? data.summary : undefined,
      });
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
  for (const grace of validationResizeGraceByWidgetId.values()) {
    clearTimeout(grace);
  }
  validationResizeGraceByWidgetId.clear();
  for (const timer of artifactEditDebounceByKey.values()) {
    clearTimeout(timer);
  }
  artifactEditDebounceByKey.clear();
  artifactEditListeners.clear();
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

/** Mark validation finished without revealing iframe (soft fallback / repair abort). */
export function markReefWidgetValidationComplete(widgetId: string): void {
  const record = hostsByWidgetId.get(widgetId);
  if (!record) return;
  record.validationDone = true;
  clearReefWidgetValidationTimer(widgetId);
}

/** Lookup mounted host record (repair + diagnostics). */
export function getReefWidgetHostRecord(
  widgetId: string,
): { host: HTMLElement; widgetHtml: string; validationDone: boolean } | undefined {
  const record = hostsByWidgetId.get(widgetId);
  if (!record) return undefined;
  return {
    host: record.host,
    widgetHtml: record.widgetHtml,
    validationDone: record.validationDone,
  };
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
