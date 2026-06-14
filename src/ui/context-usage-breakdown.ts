/**
 * Context usage breakdown popover (MIN-13) — section token rows with bars.
 */

import type { ContextBudget, ContextUsageSection } from '../chat/context-usage';
import { TOKEN_ESTIMATE_TOOLTIP } from '../chat/prompts/token-estimate-core';
import {
  getActiveContextUsageSurface,
  getContextUsageBreakdownPanel,
  getContextUsageRingButton,
  type ContextUsageSurface,
} from './context-usage-surface';

let panelOpen = false;
let openSurface: ContextUsageSurface | null = null;

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  return n.toLocaleString();
}

function maxSectionTokens(sections: ContextUsageSection[]): number {
  let max = 1;
  for (const section of sections) {
    if (section.tokens > max) max = section.tokens;
  }
  return max;
}

function renderSectionRow(section: ContextUsageSection, scaleMax: number): string {
  const fill = scaleMax > 0 ? section.tokens / scaleMax : 0;
  return `
    <div class="context-usage-row" data-section="${section.key}">
      <span class="context-usage-row__label">${section.label}</span>
      <div class="context-usage-row__track" aria-hidden="true">
        <div class="context-usage-row__fill" style="--fill-scale: ${fill.toFixed(4)}"></div>
      </div>
      <span class="context-usage-row__count">~${formatTokens(section.tokens)}</span>
    </div>`;
}

function renderPanelBody(budget: ContextBudget): string {
  const scaleMax = maxSectionTokens(budget.breakdown);
  const rows = budget.breakdown.map((s) => renderSectionRow(s, scaleMax)).join('');
  const limitLine =
    budget.limit != null
      ? `<p class="context-usage-breakdown__meta"><span>Context limit</span><strong>${formatTokens(budget.limit)}</strong></p>`
      : `<p class="context-usage-breakdown__meta context-usage-breakdown__meta--warn">Context limit unknown for this model.</p>`;
  const usedLine = `<p class="context-usage-breakdown__meta"><span>Estimated used</span><strong>~${formatTokens(budget.used)}</strong></p>`;
  const remainingLine =
    budget.remaining != null
      ? `<p class="context-usage-breakdown__meta"><span>Remaining (approx.)</span><strong>~${formatTokens(budget.remaining)}</strong></p>`
      : '';
  const lastTurnLine =
    budget.lastTurnPromptTokens != null
      ? `<p class="context-usage-breakdown__meta context-usage-breakdown__meta--api"><span>Last turn (API)</span><strong>${formatTokens(budget.lastTurnPromptTokens)} prompt tokens</strong></p>`
      : '';
  const estimateNote = budget.isEstimate
    ? `<p class="context-usage-breakdown__note">${TOKEN_ESTIMATE_TOOLTIP}</p>`
    : `<p class="context-usage-breakdown__note">Section sizes are approximate (chars ÷ 4). Last turn prompt tokens came from the provider.</p>`;

  return `
    <header class="context-usage-breakdown__header">
      <h3 class="context-usage-breakdown__title">Context usage</h3>
      <p class="context-usage-breakdown__model">${budget.modelDisplayName}</p>
    </header>
    ${limitLine}
    ${usedLine}
    ${remainingLine}
    ${lastTurnLine}
    <div class="context-usage-breakdown__sections" role="list">${rows}</div>
    ${estimateNote}
  `;
}

/** Whether the breakdown panel is open. */
export function isContextUsageBreakdownOpen(): boolean {
  return panelOpen;
}

/** Close anchored breakdown panel. */
export function closeContextUsageBreakdown(): void {
  const surface = openSurface ?? getActiveContextUsageSurface();
  const panel = getContextUsageBreakdownPanel(surface);
  const ring = getContextUsageRingButton(surface);
  if (!panel || panel.classList.contains('hidden')) {
    panelOpen = false;
    openSurface = null;
    return;
  }
  panel.classList.add('hidden');
  panelOpen = false;
  openSurface = null;
  ring?.setAttribute('aria-expanded', 'false');
}

/** Open or toggle breakdown for the given budget snapshot. */
export function toggleContextUsageBreakdown(
  budget: ContextBudget,
  surface: ContextUsageSurface = getActiveContextUsageSurface(),
): void {
  const panel = getContextUsageBreakdownPanel(surface);
  const ring = getContextUsageRingButton(surface);
  if (!panel || !ring) return;

  if (panelOpen && openSurface?.breakdownId === surface.breakdownId) {
    closeContextUsageBreakdown();
    return;
  }

  if (panelOpen) closeContextUsageBreakdown();

  panel.innerHTML = renderPanelBody(budget);
  panel.classList.remove('hidden');
  panelOpen = true;
  openSurface = surface;
  ring.setAttribute('aria-expanded', 'true');
}

/** Repaint open panel after budget refresh. */
export function syncContextUsageBreakdownIfOpen(budget: ContextBudget): void {
  if (!panelOpen || !openSurface) return;
  const panel = getContextUsageBreakdownPanel(openSurface);
  if (!panel) return;
  panel.innerHTML = renderPanelBody(budget);
}
