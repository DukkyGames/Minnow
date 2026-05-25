/**
 * Silent in-place reef widget repair: patch fence in history and re-mount without error UI.
 */

import { streaming, streamingChatId } from '../../app-state.ts';
import { lintReefWidgetFence } from './widget-fence-lint.ts';
import { extractFirstReefWidgetFenceBody, replaceReefWidgetFenceInMarkdown } from './widget-fence-markdown.ts';
import { prepareReefWidgetHtml } from './widget-fence-body.ts';
import { runWidgetCompletion, resolveWidgetLlmBinding } from './run-widget-completion.ts';
import { createReefWidgetSoftFallbackPanel } from './widget-error-ui.ts';
import type { ApiMessage } from '../../types.ts';

/** Max silent repair attempts per widget slot. */
export const REEF_WIDGET_MAX_REPAIR_ATTEMPTS = 2;

const attemptKey = (chatId: string, historyIndex: number, widgetIndex: number): string =>
  `${chatId}:${historyIndex}:${widgetIndex}`;

const attemptsByKey = new Map<string, number>();
let repairInFlight = false;

/** True when the given chat has an in-flight assistant turn. */
function isChatStreaming(chatId: string): boolean {
  return streaming && streamingChatId === chatId;
}

const WIDGET_REPAIR_SYSTEM_PROMPT = `You fix broken Minnow reef-widget HTML fences. Output exactly one complete \`\`\`reef-widget fence with corrected HTML/CSS/JS only. No commentary outside the fence.

Chart rules (Recharts):
- Wrap charts in class rw-chart (or mw-chart).
- YAxis: type="number", width={60}, tickFormatter using toFixed (never toExponential).
- LineChart/BarChart margin.left >= 36.
- useLayoutEffect + window.minnow.requestResize() after layout.
- Prefer React.createElement for chart trees and root render (React.createElement(App)).
- Quote CSS variables in style objects: 'var(--mn-fg)' not bare var(--mn-fg).

Reference pattern: @minnow/reef/widgets/snippet-chart-line.md`;

/** Reset repair counters (tests). */
export function resetReefWidgetRepairStateForTests(): void {
  attemptsByKey.clear();
  repairInFlight = false;
}

/** True when this host slot has used all silent repair attempts. */
export function hasExhaustedSilentWidgetRepair(host: HTMLElement): boolean {
  const chatId = host.dataset.chatId?.trim();
  const historyIndex = Number.parseInt(host.dataset.historyIndex ?? '', 10);
  const widgetIndex = Number.parseInt(host.dataset.widgetIndex ?? '', 10);
  if (!chatId || !Number.isFinite(historyIndex) || !Number.isFinite(widgetIndex)) {
    return false;
  }
  return getAttemptCount(chatId, historyIndex, widgetIndex) >= REEF_WIDGET_MAX_REPAIR_ATTEMPTS;
}

function getAttemptCount(chatId: string, historyIndex: number, widgetIndex: number): number {
  return attemptsByKey.get(attemptKey(chatId, historyIndex, widgetIndex)) ?? 0;
}

function incrementAttempt(chatId: string, historyIndex: number, widgetIndex: number): number {
  const key = attemptKey(chatId, historyIndex, widgetIndex);
  const next = getAttemptCount(chatId, historyIndex, widgetIndex) + 1;
  attemptsByKey.set(key, next);
  return next;
}

async function loadSessionsApi(): Promise<typeof import('../../state/sessions.ts')> {
  return import('../../state/sessions.ts');
}

/** Last assistant history index for the active chat, or -1. */
async function lastAssistantHistoryIndex(chatId: string): Promise<number> {
  const { findChatById, getActiveChat } = await loadSessionsApi();
  const chat = findChatById(chatId) ?? (getActiveChat().id === chatId ? getActiveChat() : null);
  if (!chat) return -1;
  for (let i = chat.history.length - 1; i >= 0; i -= 1) {
    if (chat.history[i].role === 'assistant') return i;
  }
  return -1;
}

export interface SilentWidgetRepairContext {
  widgetId: string;
  host: HTMLElement;
  widgetHtml: string;
  errors: string[];
  warnings?: string[];
}

/**
 * Try to start silent repair. Returns true when repair was enqueued (caller must not show error UI).
 */
export function tryEnqueueSilentWidgetRepair(ctx: SilentWidgetRepairContext): boolean {
  if (repairInFlight || streaming) return false;

  const chatId = ctx.host.dataset.chatId?.trim();
  const historyIndexRaw = ctx.host.dataset.historyIndex;
  const widgetIndexRaw = ctx.host.dataset.widgetIndex;
  if (!chatId || historyIndexRaw == null || widgetIndexRaw == null) return false;

  const historyIndex = Number.parseInt(historyIndexRaw, 10);
  const widgetIndex = Number.parseInt(widgetIndexRaw, 10);
  if (!Number.isFinite(historyIndex) || !Number.isFinite(widgetIndex)) return false;

  if (isChatStreaming(chatId)) return false;

  if (getAttemptCount(chatId, historyIndex, widgetIndex) >= REEF_WIDGET_MAX_REPAIR_ATTEMPTS) {
    return false;
  }

  incrementAttempt(chatId, historyIndex, widgetIndex);
  repairInFlight = true;

  void runSilentWidgetRepair({
    widgetId: ctx.widgetId,
    chatId,
    historyIndex,
    widgetIndex,
    errors: ctx.errors,
    warnings: ctx.warnings ?? [],
    record: { host: ctx.host, widgetHtml: ctx.widgetHtml },
  }).finally(() => {
    repairInFlight = false;
  });

  return true;
}

interface RunSilentRepairInput {
  widgetId: string;
  chatId: string;
  historyIndex: number;
  widgetIndex: number;
  errors: string[];
  warnings: string[];
  record: { host: HTMLElement; widgetHtml: string };
}

async function runSilentWidgetRepair(input: RunSilentRepairInput): Promise<void> {
  const { findChatById, getActiveChat, scheduleSaveSessions, touchChat } = await loadSessionsApi();
  const active = getActiveChat();
  if (active.id !== input.chatId) return;
  if (isChatStreaming(input.chatId)) return;
  if (input.historyIndex !== (await lastAssistantHistoryIndex(input.chatId))) return;

  const chat = findChatById(input.chatId) ?? active;
  const row = chat.history[input.historyIndex];
  if (!row || row.role !== 'assistant' || typeof row.content !== 'string') return;

  const lint = lintReefWidgetFence(input.record.widgetHtml);
  const errorLines = [
    ...input.errors,
    ...lint.errors,
    ...input.warnings,
    ...lint.warnings,
  ]
    .map((e) => e.trim())
    .filter(Boolean);

  const userPrompt = [
    'Fix this reef-widget fence body. Errors:',
    ...errorLines.map((e) => `- ${e}`),
    '',
    'Broken fence body:',
    '```reef-widget',
    input.record.widgetHtml,
    '```',
  ].join('\n');

  const messages: ApiMessage[] = [
    { role: 'system', content: WIDGET_REPAIR_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  const binding = await resolveWidgetLlmBinding(chat);
  const repairAbort = new AbortController();
  const repairTimeout = setTimeout(() => repairAbort.abort(), 120_000);
  let fixedBody = '';
  try {
    const repaired = await runWidgetCompletion({
      providerId: binding.providerId,
      modelId: binding.modelId,
      messages,
      signal: repairAbort.signal,
      onDelta: () => {},
    });
    fixedBody = repaired.text;
  } catch {
    clearTimeout(repairTimeout);
    showSoftFallbackOnHost(input.record.host);
    return;
  } finally {
    clearTimeout(repairTimeout);
  }

  const parsed = extractFirstReefWidgetFenceBody(fixedBody);
  if (!parsed) {
    showSoftFallbackOnHost(input.record.host);
    return;
  }

  const prepared = prepareReefWidgetHtml(parsed);
  if (prepared.ok === false) {
    showSoftFallbackOnHost(input.record.host);
    return;
  }

  const updatedMarkdown = replaceReefWidgetFenceInMarkdown(
    row.content,
    prepared.value.html,
    input.widgetIndex,
  );
  row.content = updatedMarkdown;
  touchChat(chat);
  scheduleSaveSessions();

  const msgEl = input.record.host.closest('.msg');
  const bubble = msgEl?.querySelector('.msg-bubble');
  if (bubble instanceof HTMLElement) {
    const { setAssistantBubbleContent } = await import('../../markdown/renderer.ts');
    setAssistantBubbleContent(bubble, updatedMarkdown, {
      streaming: false,
      modeId: chat.modeId,
    });
  }
}

/** Show non-technical placeholder when repair is exhausted or failed. */
export function showSoftFallbackOnHost(host: HTMLElement): void {
  const widgetId = host.dataset.widgetId?.trim();
  if (widgetId) {
    void import('./widget-bridge.ts').then(({ markReefWidgetValidationComplete }) => {
      markReefWidgetValidationComplete(widgetId);
    });
  }

  host.classList.remove('reef-widget-host--validating');
  host.querySelector('.reef-widget-validating-status')?.remove();
  const iframe = host.querySelector('iframe.reef-widget-iframe');
  iframe?.remove();
  if (!host.querySelector('.reef-widget-soft-fallback')) {
    host.appendChild(createReefWidgetSoftFallbackPanel());
  }
  host.classList.add('reef-widget-host--unavailable');
}
