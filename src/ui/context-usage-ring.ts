/**
 * In-chat context window usage ring (MIN-13) — composer stack indicator.
 */

import {
  estimateAttachmentTokens,
  getContextBudget,
  type ContextBudget,
} from '../chat/context-usage';
import { TOKEN_ESTIMATE_TOOLTIP } from '../chat/prompts/token-estimate-core';
import { getPendingAttachments } from '../attachments/store';
import { getActiveChat } from '../state/sessions';
import {
  closeContextUsageBreakdown,
  isContextUsageBreakdownOpen,
  syncContextUsageBreakdownIfOpen,
  toggleContextUsageBreakdown,
} from './context-usage-breakdown';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let lastBudget: ContextBudget | null = null;

const WARN_PERCENT = 85;

function readPendingComposerText(): string {
  const el = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  return el?.value ?? '';
}

function getRingButton(): HTMLButtonElement | null {
  return document.getElementById('contextUsageRing') as HTMLButtonElement | null;
}

function getRingSvg(): SVGSVGElement | null {
  return document.querySelector('#contextUsageRing .context-usage-ring__svg');
}

function formatTooltip(budget: ContextBudget): string {
  const lines: string[] = [budget.modelDisplayName];
  if (budget.limit != null) {
    lines.push(`Context: ${budget.limit.toLocaleString()} tokens`);
  } else {
    lines.push('Context limit unknown');
  }
  lines.push(`Used (approx.): ~${budget.used.toLocaleString()}`);
  if (budget.remaining != null) {
    lines.push(`Remaining (approx.): ~${budget.remaining.toLocaleString()}`);
  }
  if (budget.lastTurnPromptTokens != null) {
    lines.push(`Last turn prompt: ${budget.lastTurnPromptTokens.toLocaleString()} (API)`);
  }
  lines.push(TOKEN_ESTIMATE_TOOLTIP);
  return lines.join('\n');
}

function paintRing(budget: ContextBudget): void {
  const button = getRingButton();
  const svg = getRingSvg();
  if (!button || !svg) return;

  const percent = budget.percent ?? 0;
  const warn = budget.percent != null && budget.percent >= WARN_PERCENT;
  button.classList.toggle('context-usage-ring--warn', warn);
  button.classList.toggle('context-usage-ring--unknown-limit', budget.limit == null);

  const track = svg.querySelector('.context-usage-ring__track') as SVGCircleElement | null;
  const fill = svg.querySelector('.context-usage-ring__fill') as SVGCircleElement | null;
  if (track && fill) {
    const radius = 10;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - Math.min(1, percent / 100));
    fill.style.strokeDasharray = `${circumference}`;
    fill.style.strokeDashoffset = String(offset);
  }

  const label =
    budget.limit != null
      ? `Context ${percent}% used, ~${budget.used.toLocaleString()} of ${budget.limit.toLocaleString()} tokens`
      : `Context ~${budget.used.toLocaleString()} tokens used, limit unknown`;
  button.setAttribute('aria-label', label);
  button.title = formatTooltip(budget);
}

async function runRefresh(): Promise<void> {
  try {
    const chat = getActiveChat();
    const modelSelect = document.getElementById('modelSelect') as HTMLSelectElement | null;
    const modelId = modelSelect?.value || chat.modelId || '';
    const budget = await getContextBudget({
      chat,
      modelId,
      pendingComposerText: readPendingComposerText(),
      pendingAttachmentTokens: estimateAttachmentTokens(getPendingAttachments()),
    });
    lastBudget = budget;
    paintRing(budget);
    syncContextUsageBreakdownIfOpen(budget);
  } catch {
    const button = getRingButton();
    if (button) {
      button.classList.remove('context-usage-ring--warn');
      button.setAttribute(
        'aria-label',
        'Context usage unavailable',
      );
      button.title = 'Could not estimate context usage.';
    }
  }
}

/** Recompute context ring immediately. */
export function refreshContextUsageRing(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  inFlight = runRefresh().finally(() => {
    inFlight = null;
  });
}

/** Debounced refresh (composer typing, tool toggles). */
export function scheduleContextUsageRefresh(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    refreshContextUsageRing();
  }, 200);
}

let initialized = false;

/** Mount ring handlers and listeners (call once from initApp). */
export function initContextUsageRing(): void {
  if (initialized) return;
  initialized = true;

  const button = getRingButton();
  const panel = document.getElementById('contextUsageBreakdown');
  if (!button) return;

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (lastBudget) {
      toggleContextUsageBreakdown(lastBudget);
    } else {
      void runRefresh().then(() => {
        if (lastBudget) toggleContextUsageBreakdown(lastBudget);
      });
    }
  });

  document.addEventListener('click', (event) => {
    if (!isContextUsageBreakdownOpen()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (button.contains(target)) return;
    if (panel?.contains(target)) return;
    closeContextUsageBreakdown();
  });

  const msgInput = document.getElementById('msgInput');
  msgInput?.addEventListener('input', () => scheduleContextUsageRefresh());

  const modelSelect = document.getElementById('modelSelect');
  modelSelect?.addEventListener('change', () => refreshContextUsageRing());

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshContextUsageRing();
  });
}

/** Latest budget snapshot (tests / debug). */
export function getLastContextBudget(): ContextBudget | null {
  return lastBudget;
}
