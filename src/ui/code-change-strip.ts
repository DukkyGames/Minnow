/**
 * Composer strip: cumulative +/− line stats for the active chat.
 */

import type { Chat } from '../types';
import {
  formatCodeChangeTotalsText,
  hasCodeChangeTotals,
} from '../usage/code-change-ledger';

/** Show or hide the strip above the input bar from chat totals. */
export function updateCodeChangeStrip(chat?: Chat | null): void {
  const strip = document.getElementById('codeChangeStrip');
  const statsEl = document.getElementById('codeChangeStripStats');
  if (!strip || !statsEl) return;

  const totals = chat?.codeChangeTotals;
  if (!hasCodeChangeTotals(totals) || !totals) {
    strip.classList.add('hidden');
    statsEl.textContent = '';
    return;
  }

  strip.classList.remove('hidden');
  const addSpan = document.createElement('span');
  addSpan.className = 'code-change-strip__add';
  addSpan.textContent = `+${totals.additions}`;
  const delSpan = document.createElement('span');
  delSpan.className = 'code-change-strip__del';
  delSpan.textContent = `−${totals.deletions}`;
  statsEl.replaceChildren(addSpan, document.createTextNode(' '), delSpan);
  strip.setAttribute(
    'aria-label',
    `Code changes in this chat: ${formatCodeChangeTotalsText(totals)}`,
  );
}
