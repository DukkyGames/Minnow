/**
 * Tool-call / tool-result bubbles in the chat transcript (SA-8).
 */

import type { CodeChangeStats, ToolImageAttachment } from '../types';
import { formatAskQuestionResultAsListItems } from './format-ask-question-result';

/** Max characters shown in expanded result <pre> blocks. */
const RESULT_DISPLAY_CAP = 2048;

/** Treat executor error strings as failed tool runs. */
export function isToolResultFailure(result: string): boolean {
  return result.trimStart().startsWith('Error:');
}

/** Accessible label for the collapsed tool-call summary row. */
function toolSummaryAriaLabel(name: string, status: 'running' | 'failed' | 'succeeded'): string {
  if (status === 'running') return `${name}, running, show details`;
  return `${name}, ${status}, show details`;
}

/** GitHub-style +/− badge for file-mutation tool results. */
function appendCodeChangeBadge(summary: Element, codeChange?: CodeChangeStats): void {
  summary.querySelector('.tool-call-code-change')?.remove();
  if (!codeChange || (codeChange.additions === 0 && codeChange.deletions === 0)) return;

  const badge = document.createElement('span');
  badge.className = 'tool-call-code-change';
  badge.setAttribute('aria-label', `Lines changed: plus ${codeChange.additions}, minus ${codeChange.deletions}`);

  if (codeChange.additions > 0) {
    const add = document.createElement('span');
    add.className = 'tool-call-code-change__add';
    add.textContent = `+${codeChange.additions}`;
    badge.appendChild(add);
  }
  if (codeChange.deletions > 0) {
    const del = document.createElement('span');
    del.className = 'tool-call-code-change__del';
    del.textContent = `−${codeChange.deletions}`;
    badge.appendChild(del);
  }

  summary.appendChild(badge);
}

/** Truncate long tool output for the UI while keeping the full string in history. */
function capDisplayText(text: string): string {
  if (text.length <= RESULT_DISPLAY_CAP) return text;
  const omitted = text.length - RESULT_DISPLAY_CAP;
  return `${text.slice(0, RESULT_DISPLAY_CAP)}\n\n… (${omitted} more characters)`;
}

/** Pretty-print args or results inside monospace <pre> blocks. */
function formatForPre(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Pending tool invocation bubble: collapsed summary with spinner, expandable args/result body.
 * Returns the outer `.tool-call-msg` wrapper for `renderToolResult`.
 */
export function renderToolCall(
  name: string,
  argsObj: Record<string, unknown> | unknown
): HTMLElement {
  const empty = document.getElementById('emptyState');
  if (empty) empty.remove();

  const wrap = document.createElement('div');
  wrap.className = 'tool-call-msg';
  wrap.dataset.toolName = name;
  wrap.setAttribute('aria-busy', 'true');

  const details = document.createElement('details');
  details.className = 'tool-call-details';

  const summary = document.createElement('summary');
  summary.className = 'tool-call-summary';
  summary.setAttribute('aria-label', toolSummaryAriaLabel(name, 'running'));

  const statusGlyph = document.createElement('span');
  statusGlyph.className = 'tool-call-status';

  const spinner = document.createElement('span');
  spinner.className = 'tool-call-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  statusGlyph.appendChild(spinner);

  const title = document.createElement('span');
  title.className = 'tool-call-title';
  title.textContent = name;

  const statusLabel = document.createElement('span');
  statusLabel.className = 'tool-call-status-label tool-call-status-label--pending';
  statusLabel.textContent = 'Running';

  summary.appendChild(statusGlyph);
  summary.appendChild(title);
  summary.appendChild(statusLabel);

  const body = document.createElement('div');
  body.className = 'tool-call-body';

  const argsLabel = document.createElement('div');
  argsLabel.className = 'tool-call-section-label';
  argsLabel.textContent = 'Arguments';

  const argsPre = document.createElement('pre');
  argsPre.className = 'tool-call-pre tool-call-pre--args';
  argsPre.textContent = formatForPre(argsObj);

  body.appendChild(argsLabel);
  body.appendChild(argsPre);

  details.appendChild(summary);
  details.appendChild(body);
  wrap.appendChild(details);

  return wrap;
}

function tryParseArgsFromToolWrap(wrap: HTMLElement): unknown {
  const pre = wrap.querySelector('.tool-call-pre--args');
  if (!pre?.textContent) return undefined;
  try {
    return JSON.parse(pre.textContent) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Mark a tool-call bubble complete: status glyph, Success/Failed label, result <pre> in body.
 */
export function renderToolResult(
  wrap: HTMLElement,
  result: string,
  attachments?: ToolImageAttachment[],
  toolArgs?: Record<string, unknown> | unknown,
  codeChange?: CodeChangeStats,
): void {
  const details = wrap.querySelector('.tool-call-details');
  const summary = wrap.querySelector('.tool-call-summary');
  const statusGlyph = wrap.querySelector('.tool-call-status');
  const statusLabel = wrap.querySelector('.tool-call-status-label');
  const body = wrap.querySelector('.tool-call-body');
  if (!details || !summary || !statusGlyph || !statusLabel || !body) return;

  const toolName =
    wrap.dataset.toolName ||
    wrap.querySelector('.tool-call-title')?.textContent?.trim() ||
    'tool';
  const failed = isToolResultFailure(result);

  wrap.setAttribute('role', 'status');
  wrap.setAttribute('aria-live', 'polite');
  wrap.removeAttribute('aria-busy');
  wrap.classList.toggle('tool-call-msg--fail', failed);
  wrap.classList.toggle('tool-call-msg--ok', !failed);
  summary.classList.toggle('tool-call-summary--fail', failed);
  summary.classList.toggle('tool-call-summary--ok', !failed);
  summary.setAttribute(
    'aria-label',
    toolSummaryAriaLabel(toolName, failed ? 'failed' : 'succeeded'),
  );

  statusGlyph.innerHTML = '';
  statusGlyph.classList.remove('tool-call-status--ok', 'tool-call-status--fail');
  statusGlyph.classList.add(failed ? 'tool-call-status--fail' : 'tool-call-status--ok');

  const glyph = document.createElement('span');
  glyph.className = failed ? 'tool-call-glyph tool-call-glyph--fail' : 'tool-call-glyph tool-call-glyph--ok';
  glyph.textContent = failed ? '✗' : '✓';
  glyph.setAttribute('aria-label', failed ? 'Failed' : 'Succeeded');
  statusGlyph.appendChild(glyph);

  statusLabel.textContent = failed ? 'Failed' : 'Success';
  statusLabel.classList.remove('tool-call-status-label--pending');
  statusLabel.classList.add(failed ? 'tool-call-status-label--fail' : 'tool-call-status-label--ok');

  if (!failed) {
    appendCodeChangeBadge(summary, codeChange);
  } else {
    summary.querySelector('.tool-call-code-change')?.remove();
  }

  if (body.querySelector('.tool-call-pre--result')) return;

  const resultLabel = document.createElement('div');
  resultLabel.className = 'tool-call-section-label';
  resultLabel.textContent = 'Result';

  const useAskQuestionList =
    toolName === 'ask_question' && !failed && typeof result === 'string';

  if (useAskQuestionList) {
    const argsForFormat = toolArgs ?? tryParseArgsFromToolWrap(wrap);
    const items = formatAskQuestionResultAsListItems(result, argsForFormat);
    if (items.length > 0) {
      const list = document.createElement('ol');
      list.className = 'tool-call-answer-list';
      for (const line of items) {
        const li = document.createElement('li');
        li.textContent = line;
        list.appendChild(li);
      }
      body.appendChild(resultLabel);
      body.appendChild(list);
    } else {
      const resultPre = document.createElement('pre');
      resultPre.className = 'tool-call-pre tool-call-pre--result';
      resultPre.textContent = capDisplayText(result);
      body.appendChild(resultLabel);
      body.appendChild(resultPre);
    }
  } else {
    const resultPre = document.createElement('pre');
    resultPre.className = 'tool-call-pre tool-call-pre--result';
    resultPre.textContent = capDisplayText(result);
    body.appendChild(resultLabel);
    body.appendChild(resultPre);
  }

  if (attachments?.length) {
    for (const att of attachments) {
      if (att.type !== 'image' || !att.url) continue;
      const img = document.createElement('img');
      img.className = 'tool-call-screenshot';
      img.loading = 'lazy';
      img.alt = att.alt ?? 'Browser screenshot';
      img.src = att.url;
      body.appendChild(img);
    }
  }
}
