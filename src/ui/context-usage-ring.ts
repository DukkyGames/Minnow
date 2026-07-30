/**
 * In-chat context window usage ring (MIN-13) — composer stack indicator.
 */

import { getContextInFlightOverlay } from '../chat/context-in-flight';
import {
  estimateAttachmentTokens,
  getContextBudget,
  type ContextBudget,
} from '../chat/context-usage';
import { TOKEN_ESTIMATE_TOOLTIP } from '../chat/prompts/token-estimate-core';
import { getPendingAttachments } from '../attachments/store';
import { resolveEffectiveChatModelBinding } from './default-model';
import { getActiveChat } from '../state/sessions';
import { getActiveComposerSurface } from './composer-surface';
import {
  bindContextUsageProfileTabs,
  closeContextUsageBreakdown,
  isContextUsageBreakdownOpen,
  syncContextUsageBreakdownIfOpen,
  toggleContextUsageBreakdown,
} from './context-usage-breakdown';
import {
  getActiveContextUsageSurface,
  getContextUsageRingButton,
  getContextUsageRingSvg,
  listContextUsageSurfaces,
  type ContextUsageSurface,
} from './context-usage-surface';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let lastBudget: ContextBudget | null = null;

const WARN_PERCENT = 85;

function readPendingComposerText(): string {
  return getActiveComposerSurface().inputEl?.value ?? '';
}

function formatTooltip(budget: ContextBudget): string {
  const lines: string[] = [budget.modelDisplayName];
  if (budget.limit != null) {
    lines.push(`Context: ${budget.limit.toLocaleString()} tokens`);
  } else {
    lines.push('Context limit unknown — compression disabled');
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

function paintRingSurface(surface: ContextUsageSurface, budget: ContextBudget): void {
  const button = getContextUsageRingButton(surface);
  const svg = getContextUsageRingSvg(surface);
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

function paintUnavailable(surface: ContextUsageSurface): void {
  const button = getContextUsageRingButton(surface);
  if (!button) return;
  button.classList.remove('context-usage-ring--warn');
  button.setAttribute('aria-label', 'Context usage unavailable');
  button.title = 'Could not estimate context usage.';
}

async function runRefresh(): Promise<void> {
  try {
    const chat = getActiveChat();
    const { selectValue } = resolveEffectiveChatModelBinding(chat);
    const modelId = selectValue || chat.modelId || '';
    const budget = await getContextBudget({
      chat,
      modelId,
      pendingComposerText: readPendingComposerText(),
      pendingAttachmentTokens: estimateAttachmentTokens(getPendingAttachments()),
      inFlight: getContextInFlightOverlay(chat.id),
    });
    lastBudget = budget;
    for (const surface of listContextUsageSurfaces()) {
      paintRingSurface(surface, budget);
    }
    syncContextUsageBreakdownIfOpen(budget);
  } catch {
    for (const surface of listContextUsageSurfaces()) {
      paintUnavailable(surface);
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

function bindRingButton(surface: ContextUsageSurface): void {
  const button = getContextUsageRingButton(surface);
  if (!button || button.dataset.contextRingBound === '1') return;
  button.dataset.contextRingBound = '1';

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const active = getActiveContextUsageSurface();
    if (surface.ringId !== active.ringId) return;
    if (lastBudget) {
      toggleContextUsageBreakdown(lastBudget, surface);
    } else {
      void runRefresh().then(() => {
        if (lastBudget) toggleContextUsageBreakdown(lastBudget, surface);
      });
    }
  });
}

/** Bind any context rings added after initial boot (e.g. desktop composer). */
export function bindContextUsageRings(): void {
  bindContextUsageProfileTabs();
  for (const surface of listContextUsageSurfaces()) {
    bindRingButton(surface);
  }
}

let initialized = false;

/** Mount ring handlers and listeners (call once from initApp). */
export function initContextUsageRing(): void {
  if (initialized) return;
  initialized = true;

  bindContextUsageProfileTabs();

  for (const surface of listContextUsageSurfaces()) {
    bindRingButton(surface);
  }

  document.addEventListener('click', (event) => {
    if (!isContextUsageBreakdownOpen()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    for (const surface of listContextUsageSurfaces()) {
      const button = getContextUsageRingButton(surface);
      const panel = document.getElementById(surface.breakdownId);
      if (button?.contains(target) || panel?.contains(target)) return;
    }
    closeContextUsageBreakdown();
  });

  for (const { inputId } of [
    { inputId: 'msgInput' },
    { inputId: 'chatAppInput' },
    { inputId: 'desktopInput' },
  ]) {
    document.getElementById(inputId)?.addEventListener('input', () => scheduleContextUsageRefresh());
  }

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
