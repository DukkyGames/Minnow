/**
 * Tool-call / tool-result bubbles in the chat transcript (SA-8).
 */

import type { CodeChangeDiffLine, CodeChangeStats, ToolImageAttachment } from '../types';
import { BUILT_IN_TOOLS } from '../tools/definitions';
import { renderUnifiedPromptDiff } from './prompt-diff-unified';
import { formatAskQuestionResultAsListItems } from './format-ask-question-result';

/** Human-readable labels for built-in tools (fallback: snake_case → spaces). */
const TOOL_LABEL_MAP = new Map(BUILT_IN_TOOLS.map((t) => [t.id, t.label]));

/** File write/edit tools that render as open diff cards instead of collapsible bubbles. */
const FILE_MUTATION_TOOLS = new Set([
  'save_file',
  'replace_text_in_file',
  'append_file',
  'insert_at_line',
  'move_file',
  'delete_path',
]);

/** Shell tools that expose a user-facing Stop control while a run is active. */
const KILLABLE_SHELL_TOOLS = new Set(['execute_command', 'start_background_command']);

export function isKillableShellTool(name: string): boolean {
  return KILLABLE_SHELL_TOOLS.has(name);
}

/** Parse runId from a successful background shell tool JSON result. */
export function extractShellRunIdFromToolResult(
  toolName: string,
  result: string,
): string | null {
  const payload = parseBackgroundShellToolPayload(toolName, result);
  return payload?.runId ?? null;
}

export interface BackgroundShellToolPayload {
  runId: string;
  output?: string;
  startedAt?: number;
}

/** Parse runId and optional startup fields from background shell tool JSON. */
export function parseBackgroundShellToolPayload(
  toolName: string,
  result: string,
): BackgroundShellToolPayload | null {
  if (!isKillableShellTool(toolName) || isToolResultFailure(result)) return null;
  try {
    const parsed = JSON.parse(result) as {
      runId?: unknown;
      background?: unknown;
      ok?: unknown;
      output?: unknown;
      startedAt?: unknown;
    };
    if (parsed.ok !== true) return null;
    if (toolName === 'execute_command' && parsed.background !== true) return null;
    const runId =
      typeof parsed.runId === 'string' && parsed.runId.trim()
        ? parsed.runId.trim()
        : null;
    if (!runId) return null;
    return {
      runId,
      ...(typeof parsed.output === 'string' && parsed.output.length
        ? { output: parsed.output }
        : {}),
      ...(typeof parsed.startedAt === 'number' && Number.isFinite(parsed.startedAt)
        ? { startedAt: parsed.startedAt }
        : {}),
    };
  } catch {
    return null;
  }
}

function appendKillButton(summary: HTMLElement, wrap: HTMLElement): void {
  const killBtn = document.createElement('button');
  killBtn.type = 'button';
  killBtn.className = 'tool-call-kill hidden';
  killBtn.textContent = 'Stop';
  killBtn.setAttribute('aria-label', 'Stop shell command');
  killBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  summary.appendChild(killBtn);
  wrap.dataset.shellKillable = 'true';
}

/** Show or hide the Stop button for a tool-call bubble. */
export function setToolCallShellRun(
  wrap: HTMLElement,
  runId: string | null,
  running: boolean,
): void {
  if (!wrap.dataset.shellKillable) return;

  if (runId && running) {
    wrap.dataset.shellRunId = runId;
  } else {
    delete wrap.dataset.shellRunId;
  }

  const killBtn = wrap.querySelector<HTMLButtonElement>('.tool-call-kill');
  if (!killBtn) return;
  killBtn.classList.toggle('hidden', !(runId && running));
  killBtn.toggleAttribute('disabled', !(runId && running));
}

/** Sync kill buttons: hide Stop when the run is no longer active. */
export function syncToolCallKillButtons(activeRunIds: Set<string>): void {
  for (const wrap of document.querySelectorAll<HTMLElement>(
    '.tool-call-msg[data-shell-killable="true"]',
  )) {
    const runId = wrap.dataset.shellRunId?.trim();
    const show = Boolean(runId && activeRunIds.has(runId));
    setToolCallShellRun(wrap, runId ?? null, show);
  }
}

export function humanizeToolName(name: string): string {
  return TOOL_LABEL_MAP.get(name) ?? name.replace(/_/g, ' ');
}

/** Last path segment for file-card summary titles. */
function pathBasename(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() ?? p;
}

/** Open a workspace-relative path in the Code editor. */
function bindOpenFileLink(el: HTMLElement, workspacePath: string): void {
  el.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void import('./file-viewer').then((m) => m.openFileInViewer(workspacePath));
  });
}

/** Resolve workspace path for a file-mutation tool bubble. */
function resolveFileCardPath(
  wrap: HTMLElement,
  codeChange?: CodeChangeStats,
  toolArgs?: Record<string, unknown> | unknown,
): string | undefined {
  if (codeChange?.path) return codeChange.path;
  const args = toolArgs ?? tryParseArgsFromToolWrap(wrap);
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const path = (args as Record<string, unknown>).path;
    return typeof path === 'string' ? path : undefined;
  }
  return undefined;
}

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

/** Mount changed-line diff (with line numbers) in the file tool card body. */
function appendCodeChangeDiffPanel(
  body: Element,
  codeChange?: CodeChangeStats,
  workspacePath?: string,
): void {
  body.querySelector('.tool-call-diff')?.remove();
  const lines = codeChange?.diffLines;
  if (!lines?.length) return;

  const panel = document.createElement('div');
  panel.className = 'tool-call-diff';

  const pathLabel =
    codeChange.path ??
    workspacePath ??
    (codeChange.paths?.length ? codeChange.paths.join(', ') : 'Changes');
  const sourceHint =
    codeChange.source === 'backfill'
      ? ' (approximate from history)'
      : codeChange.source === 'command-heuristic'
        ? ' (estimated)'
        : '';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'tool-call-diff__header tool-call-diff__header--link';
  header.textContent = `${pathLabel}${sourceHint}`;
  header.title = pathLabel;
  header.setAttribute('aria-label', `Open ${pathLabel}`);
  if (workspacePath ?? codeChange.path) {
    bindOpenFileLink(header, workspacePath ?? codeChange.path!);
  }
  panel.appendChild(header);

  const host = document.createElement('div');
  renderUnifiedPromptDiff(host, lines as CodeChangeDiffLine[], {
    changedOnly: true,
    lineNumbers: true,
  });
  panel.appendChild(host);

  if (codeChange.diffTruncated) {
    const note = document.createElement('p');
    note.className = 'settings-field-hint prompt-diff__truncated';
    note.textContent = 'Diff truncated for display.';
    panel.appendChild(note);
  }

  body.appendChild(panel);
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

  const statusGlyph = document.createElement('span');
  statusGlyph.className = 'tool-call-status';

  const spinner = document.createElement('span');
  spinner.className = 'tool-call-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  statusGlyph.appendChild(spinner);

  const argsRecord =
    argsObj && typeof argsObj === 'object' && !Array.isArray(argsObj)
      ? (argsObj as Record<string, unknown>)
      : {};
  const pathArg = typeof argsRecord.path === 'string' ? argsRecord.path : undefined;
  const isFileCard = FILE_MUTATION_TOOLS.has(name) && pathArg !== undefined;

  const title = document.createElement(isFileCard ? 'button' : 'span');
  title.className = isFileCard
    ? 'tool-call-title tool-call-title--file-link'
    : 'tool-call-title';
  if (isFileCard) {
    wrap.classList.add('tool-call-msg--file');
    details.classList.add('tool-call-details--file');
    details.open = true;
    (title as HTMLButtonElement).type = 'button';
    title.textContent = pathBasename(pathArg);
    title.setAttribute('aria-label', `Open ${pathArg}`);
    title.title = pathArg;
    wrap.dataset.filePath = pathArg;
    bindOpenFileLink(title, pathArg);
    summary.setAttribute('aria-label', toolSummaryAriaLabel(pathBasename(pathArg), 'running'));
  } else {
    title.textContent = humanizeToolName(name);
    summary.setAttribute('aria-label', toolSummaryAriaLabel(humanizeToolName(name), 'running'));
  }

  const statusLabel = document.createElement('span');
  statusLabel.className = 'tool-call-status-label tool-call-status-label--pending';
  statusLabel.textContent = 'Running';

  summary.appendChild(statusGlyph);
  summary.appendChild(title);
  summary.appendChild(statusLabel);

  if (KILLABLE_SHELL_TOOLS.has(name)) {
    appendKillButton(summary, wrap);
  }

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
  const body = wrap.querySelector('.tool-call-body') as HTMLElement | null;
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

  const isFileCard = wrap.classList.contains('tool-call-msg--file');
  const displayPath = isFileCard ? resolveFileCardPath(wrap, codeChange, toolArgs) : undefined;

  if (isFileCard && displayPath) {
    const titleEl = wrap.querySelector<HTMLElement>('.tool-call-title');
    if (titleEl) {
      const basename = pathBasename(displayPath);
      titleEl.textContent = basename;
      titleEl.setAttribute('aria-label', `Open ${displayPath}`);
      titleEl.title = displayPath;
      wrap.dataset.filePath = displayPath;
      summary.setAttribute(
        'aria-label',
        toolSummaryAriaLabel(basename, failed ? 'failed' : 'succeeded'),
      );
    }
  }

  if (isFileCard && !failed) {
    if (body.dataset.fileResultRendered !== 'true') {
      appendCodeChangeDiffPanel(body, codeChange, displayPath);
      body.dataset.fileResultRendered = 'true';
    }
    return;
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

  if (!failed && !isFileCard) {
    appendCodeChangeDiffPanel(body, codeChange, codeChange?.path);
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
