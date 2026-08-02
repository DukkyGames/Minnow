/**
 * FIM-style prompt builder and output alignment for editor AI inline completions.
 * Phase 6: structured context, LSP signals, cursor-aware alignment.
 */

import type { EditorState, Transaction } from '@codemirror/state';
import type { ApiMessage } from '../types';
import type { EditorAiCompletionConfig } from '../config/editor-ai-completion';
import { alignCompletionBrackets } from './editor-completion-brackets';
import type { CompletionMode } from './editor-completion-policy';
import { stripEditorModelOutput } from './editor-model-output';

/** Bump when prompt layout or validation rules change (cache invalidation). */
export const PROMPT_VERSION = '7';

/** Per-section character caps for optional context blocks (v7 prompt). */
export const PROMPT_SECTION_CAPS = {
  symbols: 200,
  diagnostics: 400,
  hover: 400,
  imports: 600,
  recentEdits: 400,
} as const;

export const EDITOR_AI_FIM_MARKER = '<|fim|>';

export const EDITOR_AI_COMPLETION_SYSTEM =
  'You are a code completion engine. The user message contains a <file> block with a ' +
  `${EDITOR_AI_FIM_MARKER} marker. Output only the text that should replace ${EDITOR_AI_FIM_MARKER} — ` +
  'no explanations, markdown fences, thinking tags, or comments unless they belong at the insertion point. ' +
  'Never wrap output in reasoning or thinking markup.';

/** Default total character budget for optional prompt context blocks. */
export const DEFAULT_CONTEXT_BUDGET_CHARS = 4000;

/** Timeout for optional LSP context fetches (symbols, diagnostics, hover). */
export const DEFAULT_LSP_CONTEXT_TIMEOUT_MS = 350;

/** Maximum characters for a single validated inline insertion. */
export const DEFAULT_MAX_INSERT_CHARS = 800;

export interface EditorAiPromptInput {
  state: EditorState;
  cursorPos: number;
  filePath: string;
  config: EditorAiCompletionConfig;
  /** Active model id (chat transport only — native FIM is not used). */
  modelId?: string;
  /** Optional LSP hover markdown/plain text for the cursor symbol. */
  lspHover?: string | null;
  /** Enclosing document symbols near the cursor. */
  lspSymbols?: string | null;
  /** Diagnostics near the cursor. */
  lspDiagnostics?: string | null;
  /** Recent changed lines from the editor ring buffer. */
  recentEdits?: RecentEditLine[];
}

export interface EditorAiPromptResult {
  messages: ApiMessage[];
  prefix: string;
  suffix: string;
}

/** One line that changed in a recent edit (before/after snapshots). */
export interface RecentEditLine {
  lineNumber: number;
  before: string;
  after: string;
}

/** Tracks a bounded ring of recently changed lines for prompt context. */
export class EditorRecentEditsRing {
  private readonly entries: RecentEditLine[] = [];

  constructor(private readonly maxEntries = 8) {}

  /** Compare old and new documents and record changed lines only. */
  recordDocChange(oldText: string, newText: string): void {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const maxLine = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLine; i += 1) {
      const before = oldLines[i] ?? '';
      const after = newLines[i] ?? '';
      if (before === after) continue;
      this.push({ lineNumber: i + 1, before, after });
    }
  }

  /** Record line-level edits from one CodeMirror transaction. */
  recordTransaction(tr: Transaction): void {
    if (!tr.docChanged) return;
    const oldDoc = tr.startState.doc;
    const newDoc = tr.state.doc;
    tr.changes.iterChanges((fromA, toA, fromB, toB) => {
      const startOld = oldDoc.lineAt(fromA).number;
      const endOld = oldDoc.lineAt(Math.max(fromA, toA)).number;
      const newAnchor = Math.min(fromB, newDoc.length);
      const newEnd = Math.min(toB, newDoc.length);
      const startNew = newDoc.lineAt(newAnchor).number;
      const endNewLine = newDoc.lineAt(Math.max(newAnchor, newEnd > newAnchor ? newEnd - 1 : newEnd)).number;
      const lineCount = Math.max(endOld - startOld + 1, endNewLine - startNew + 1);
      for (let i = 0; i < lineCount; i += 1) {
        const oldNum = startOld + i;
        const before = oldNum <= oldDoc.lines ? oldDoc.line(oldNum).text : '';
        const newNum = startNew + i;
        const after = newNum <= newDoc.lines ? newDoc.line(newNum).text : '';
        if (before !== after) {
          this.push({ lineNumber: newNum, before, after });
        }
      }
    });
  }

  private push(entry: RecentEditLine): void {
    const idx = this.entries.findIndex((e) => e.lineNumber === entry.lineNumber);
    if (idx >= 0) this.entries.splice(idx, 1);
    this.entries.push(entry);
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  /** Most recent changed lines (newest last). */
  snapshot(): RecentEditLine[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;
  }
}

/** Map file extension to a fenced-code language tag. */
export function fenceLangFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (!ext) return '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    mts: 'typescript',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    md: 'markdown',
    markdown: 'markdown',
    css: 'css',
    html: 'html',
    htm: 'html',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    sh: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
  };
  return map[ext] ?? ext;
}

/** Infer a language label from the file path extension. */
export function languageHintFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript React',
    mts: 'TypeScript',
    js: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    json: 'JSON',
    md: 'Markdown',
    markdown: 'Markdown',
    css: 'CSS',
    html: 'HTML',
    htm: 'HTML',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    java: 'Java',
    cpp: 'C++',
    c: 'C',
    h: 'C/C++ header',
    sh: 'Shell',
    yml: 'YAML',
    yaml: 'YAML',
  };
  return map[ext] ?? (ext || 'plain text');
}

/** Collect import / require lines from the top of a file for prompt context. */
export function extractImportSymbols(docText: string, maxLines = 48): string {
  const lines = docText.split('\n');
  const imports: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (imports.length > 0) break;
      continue;
    }
    if (
      /^(import\b|from\b|using\b|#include|require\s*\(|require\s|@import\b)/.test(trimmed)
    ) {
      imports.push(line);
      if (imports.length >= maxLines) break;
      continue;
    }
    if (imports.length > 0 && (/^\}/.test(trimmed) || /^from\b/.test(trimmed))) {
      imports.push(line);
      if (imports.length >= maxLines) break;
      continue;
    }
    if (imports.length > 0 && !/^\s/.test(line)) {
      break;
    }
  }
  return imports.join('\n');
}

/** Extract prefix/suffix around the cursor with line and char caps. */
export function extractPrefixSuffix(
  doc: EditorState['doc'],
  cursorPos: number,
  config: EditorAiCompletionConfig,
): { prefix: string; suffix: string } {
  const clampedPos = Math.max(0, Math.min(cursorPos, doc.length));
  const line = doc.lineAt(clampedPos);
  const prefixStartLine = Math.max(1, line.number - config.maxPrefixLines);
  const suffixEndLine = Math.min(
    doc.lines,
    line.number + config.maxSuffixLines,
  );

  let prefix = doc.sliceString(doc.line(prefixStartLine).from, clampedPos);
  let suffix = doc.sliceString(clampedPos, doc.line(suffixEndLine).to);

  if (prefix.length > config.maxPrefixChars) {
    prefix = prefix.slice(-config.maxPrefixChars);
  }
  if (suffix.length > config.maxSuffixChars) {
    suffix = suffix.slice(0, config.maxSuffixChars);
  }

  return { prefix, suffix };
}

/** Indentation string at the cursor (whitespace from line start to cursor). */
export function cursorIndentAt(prefix: string): string {
  const lineStart = prefix.lastIndexOf('\n') + 1;
  const linePrefix = prefix.slice(lineStart);
  const match = linePrefix.match(/^[\t ]*/);
  return match ? match[0] : '';
}

/** Minimum overlap length before trimming document boundaries. */
const MEANINGFUL_OVERLAP_MIN_LEN = 3;

/** Overlap must be long enough and include a boundary (not a 1–2 char identifier clash). */
export function isMeaningfulDocumentOverlap(slice: string): boolean {
  if (slice.length < MEANINGFUL_OVERLAP_MIN_LEN) return false;
  return /[^\w]/.test(slice) || slice.includes('\n');
}

/** Longest suffix of `a` that equals a prefix of `b` (meaningful overlaps only). */
export function longestOverlapSuffixPrefix(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  for (let len = max; len > 0; len -= 1) {
    const sliceA = a.slice(-len);
    if (sliceA === b.slice(0, len) && isMeaningfulDocumentOverlap(sliceA)) return len;
  }
  return 0;
}

interface ContextSection {
  key: string;
  priority: number;
  text: string;
}

/** Apply deterministic context budget: scope, edits, suffix, imports, diagnostics, broader. */
export function applyContextBudget(
  sections: ContextSection[],
  budgetChars: number,
): string[] {
  const sorted = [...sections]
    .filter((s) => s.text.trim())
    .sort((a, b) => a.priority - b.priority);
  const kept: string[] = [];
  let used = 0;
  for (const section of sorted) {
    const remaining = budgetChars - used;
    if (remaining <= 0) break;
    // Lower-priority sections are omitted when they do not fit entirely.
    if (section.text.length > remaining) continue;
    kept.push(section.text);
    used += section.text.length;
  }
  return kept;
}

function capPromptSection(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars);
}

function formatRecentEdits(edits: RecentEditLine[]): string {
  if (!edits.length) return '';
  const body = edits
    .map(
      (e) =>
        `L${e.lineNumber} before: ${e.before}\nL${e.lineNumber} after: ${e.after}`,
    )
    .join('\n');
  return capPromptSection(body, PROMPT_SECTION_CAPS.recentEdits);
}

/** Build chat messages for a fill-in-the-middle completion request. */
export function buildEditorAiCompletionMessages(
  input: EditorAiPromptInput,
): EditorAiPromptResult {
  const { prefix, suffix } = extractPrefixSuffix(
    input.state.doc,
    input.cursorPos,
    input.config,
  );
  const language = languageHintFromPath(input.filePath);
  const pathLine = input.filePath.trim() || 'untitled';
  const indent = cursorIndentAt(prefix);
  const currentLineStart = prefix.lastIndexOf('\n') + 1;
  const currentLineBefore = prefix.slice(currentLineStart);

  const contextSections: ContextSection[] = [
    {
      key: 'scope',
      priority: 1,
      text: `Current line before cursor:\n${currentLineBefore}`,
    },
    {
      key: 'edits',
      priority: 2,
      text: input.recentEdits?.length
        ? `Recent edits:\n${formatRecentEdits(input.recentEdits)}`
        : '',
    },
  ];

  if (input.config.includeImportContext !== false) {
    const imports = capPromptSection(
      extractImportSymbols(input.state.doc.toString()),
      PROMPT_SECTION_CAPS.imports,
    );
    if (imports) {
      contextSections.push({
        key: 'imports',
        priority: 4,
        text: `Imports / requires:\n${imports}`,
      });
    }
  }

  if (input.lspSymbols?.trim()) {
    const symbols = capPromptSection(input.lspSymbols.trim(), PROMPT_SECTION_CAPS.symbols);
    if (symbols) {
      contextSections.push({
        key: 'symbols',
        priority: 5,
        text: `Enclosing symbols:\n${symbols}`,
      });
    }
  }
  if (input.lspDiagnostics?.trim()) {
    const diagnostics = capPromptSection(
      input.lspDiagnostics.trim(),
      PROMPT_SECTION_CAPS.diagnostics,
    );
    if (diagnostics) {
      contextSections.push({
        key: 'diagnostics',
        priority: 5,
        text: `Nearby diagnostics:\n${diagnostics}`,
      });
    }
  }
  if (input.lspHover?.trim()) {
    const hover = capPromptSection(input.lspHover.trim(), PROMPT_SECTION_CAPS.hover);
    if (hover) {
      contextSections.push({
        key: 'hover',
        priority: 5,
        text: `Symbol at cursor:\n${hover}`,
      });
    }
  }

  const budget = input.config.contextBudgetChars ?? DEFAULT_CONTEXT_BUDGET_CHARS;
  const contextBlocks = applyContextBudget(contextSections, budget);

  const constraints = [
    'Insertion constraints:',
    `- Output only the text that replaces ${EDITOR_AI_FIM_MARKER} in the <file> block.`,
    '- Preserve required leading newlines and match indentation when continuing a block.',
    indent ? `- Cursor indentation: ${JSON.stringify(indent)}` : '- Cursor indentation: (none)',
    '- Do not repeat surrounding code from the <file> block.',
    '- No explanations, markdown fences, or full-file rewrites.',
  ].join('\n');

  const fileBlock = `<file>\n${prefix}${EDITOR_AI_FIM_MARKER}${suffix}\n</file>`;

  const userBody = [
    `File: ${pathLine}`,
    `Language: ${language}`,
    '---',
    constraints,
    ...(contextBlocks.length > 0 ? ['---', ...contextBlocks, '---'] : ['---']),
    fileBlock,
  ].join('\n');

  const messages: ApiMessage[] = [
    { role: 'system', content: EDITOR_AI_COMPLETION_SYSTEM },
    { role: 'user', content: userBody },
  ];

  return { messages, prefix, suffix };
}

/** Race a promise against a timeout; returns null on timeout or error. */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface LspDocumentSymbolNode {
  name: string;
  kind?: number;
  range?: { start?: { line?: number }; end?: { line?: number } };
  children?: LspDocumentSymbolNode[];
}

/** Find symbols whose range encloses the cursor line (0-based). */
export function symbolsEnclosingLine(
  symbols: LspDocumentSymbolNode[],
  line: number,
  depth = 0,
  maxDepth = 4,
): string[] {
  const names: string[] = [];
  for (const sym of symbols) {
    const start = sym.range?.start?.line ?? 0;
    const end = sym.range?.end?.line ?? start;
    if (line < start || line > end) continue;
    if (sym.name) names.push(sym.name);
    if (sym.children?.length && depth < maxDepth) {
      names.push(...symbolsEnclosingLine(sym.children, line, depth + 1, maxDepth));
    }
  }
  return names;
}

/** Format diagnostics near the cursor (within a few lines). */
export function formatNearbyDiagnostics(
  diagnostics: Array<{
    message: string;
    severity?: number;
    range?: { start?: { line?: number; character?: number } };
  }>,
  cursorLine: number,
  windowLines = 3,
): string {
  const nearby = diagnostics.filter((d) => {
    const line = d.range?.start?.line ?? 0;
    return Math.abs(line - cursorLine) <= windowLines;
  });
  if (!nearby.length) return '';
  return nearby
    .slice(0, 8)
    .map((d) => {
      const line = (d.range?.start?.line ?? 0) + 1;
      const col = (d.range?.start?.character ?? 0) + 1;
      return `L${line}:${col} ${d.message}`;
    })
    .join('\n');
}

/** Fetch optional LSP context in parallel with strict timeouts. */
export async function fetchEditorAiLspContext(
  filePath: string,
  cursorLine: number,
  cursorCharacter: number,
  editorText: string,
  config: EditorAiCompletionConfig,
  deps?: {
    fetchDocumentSymbols?: typeof import('../lsp/completion-client').fetchLspDocumentSymbols;
    fetchDiagnostics?: typeof import('../lsp/completion-client').fetchLspDiagnostics;
    fetchHover?: typeof import('../lsp/hover-client').fetchLspHover;
    timeoutMs?: number;
  },
): Promise<{ symbols: string | null; diagnostics: string | null; hover: string | null }> {
  const includeContext =
    config.includeLspContext !== false || config.includeLspHover !== false;
  if (!includeContext) {
    return { symbols: null, diagnostics: null, hover: null };
  }

  const timeoutMs = deps?.timeoutMs ?? DEFAULT_LSP_CONTEXT_TIMEOUT_MS;
  const { fetchLspDocumentSymbols, fetchLspDiagnostics } = await import(
    '../lsp/completion-client'
  );
  const { fetchLspHover } = await import('../lsp/hover-client');

  const fetchSymbols = deps?.fetchDocumentSymbols ?? fetchLspDocumentSymbols;
  const fetchDiags = deps?.fetchDiagnostics ?? fetchLspDiagnostics;
  const fetchHoverFn = deps?.fetchHover ?? fetchLspHover;

  const [symbolsResult, diagnosticsResult, hoverResult] = await Promise.all([
    config.includeLspContext !== false
      ? withTimeout(fetchSymbols(filePath), timeoutMs)
      : Promise.resolve(null),
    config.includeLspContext !== false
      ? withTimeout(fetchDiags(filePath, editorText), timeoutMs)
      : Promise.resolve(null),
    config.includeLspHover !== false
      ? withTimeout(
          fetchHoverFn(filePath, cursorLine, cursorCharacter),
          timeoutMs,
        )
      : Promise.resolve(null),
  ]);

  let symbols: string | null = null;
  if (symbolsResult?.symbols?.length) {
    const names = symbolsEnclosingLine(symbolsResult.symbols, cursorLine);
    if (names.length) symbols = names.join(' → ');
  }

  let diagnostics: string | null = null;
  if (diagnosticsResult?.length) {
    const formatted = formatNearbyDiagnostics(diagnosticsResult, cursorLine);
    if (formatted) diagnostics = formatted;
  }

  return {
    symbols,
    diagnostics,
    hover: hoverResult,
  };
}

/**
 * Build prompt payload with optional async LSP context (try/catch — never throws).
 */
export async function buildEditorAiCompletionMessagesAsync(
  input: EditorAiPromptInput,
): Promise<EditorAiPromptResult> {
  const lineInfo = input.state.doc.lineAt(input.cursorPos);
  const cursorLine = lineInfo.number - 1;
  const cursorCharacter = input.cursorPos - lineInfo.from;

  let lspHover: string | null = input.lspHover ?? null;
  let lspSymbols: string | null = null;
  let lspDiagnostics: string | null = null;

  try {
    const lsp = await fetchEditorAiLspContext(
      input.filePath,
      cursorLine,
      cursorCharacter,
      input.state.doc.toString(),
      input.config,
    );
    lspSymbols = lsp.symbols;
    lspDiagnostics = lsp.diagnostics;
    if (!lspHover) lspHover = lsp.hover;
  } catch {
    /* degrade gracefully */
  }

  return buildEditorAiCompletionMessages({
    ...input,
    lspHover,
    lspSymbols,
    lspDiagnostics,
  });
}

export interface AlignCompletionInput {
  raw: string;
  prefix: string;
  suffix: string;
  maxInsertChars?: number;
  indentUnitStr?: string;
  completionMode?: CompletionMode;
  fenceLang?: string;
}

export interface AlignCompletionResult {
  text: string;
  rejected: boolean;
  reason?: string;
}

const PROSE_RE =
  /^(?:here(?:'s| is)|the following|this (?:code|snippet|completion)|sure[,!]?|certainly)/i;

/** True when model output only repeats text already present before the cursor. */
export function isUnchangedPrefixEcho(text: string, prefix: string): boolean {
  const trimmed = text.trimEnd();
  if (!trimmed) return true;
  const prefixTail = prefix.trimEnd();
  if (trimmed === prefixTail) return true;
  if (!prefixTail.endsWith(trimmed)) return false;
  if (trimmed.length >= 3) return true;
  const lineStart = prefix.lastIndexOf('\n') + 1;
  const lastLine = prefixTail.slice(lineStart);
  if (!lastLine.length) return false;
  return trimmed.length / lastLine.length >= 0.8;
}

/** True when output looks like explanatory prose rather than insertable code. */
export function looksLikeProse(text: string): boolean {
  const firstLine = text.trim().split('\n')[0] ?? '';
  if (PROSE_RE.test(firstLine)) return true;
  if (/^(?:I |Let me |Note:|Explanation:)/i.test(firstLine)) return true;
  return false;
}

function tabWidthFromIndentUnit(indentUnitStr: string): number {
  return indentUnitStr.length > 0 ? indentUnitStr.length : 2;
}

function expandIndentToColumns(indent: string, tabWidth: number): number {
  let col = 0;
  for (const ch of indent) {
    if (ch === '\t') {
      col += tabWidth - (col % tabWidth);
    } else if (ch === ' ') {
      col += 1;
    }
  }
  return col;
}

function columnsToIndentUnitStr(col: number, indentUnitStr: string): string {
  const unit = indentUnitStr.length > 0 ? indentUnitStr : '  ';
  const units = Math.floor(col / unit.length);
  return unit.repeat(units);
}

/**
 * Re-indent model completion text: preserve leading newlines, strip leading ws on
 * line 0, anchor continuation lines to the cursor indent, normalize tabs/spaces.
 */
export function reindentCompletionText(
  text: string,
  prefix: string,
  indentUnitStr: string,
): string {
  if (!text) return '';
  const leadingNewlines = text.match(/^\n+/)?.[0] ?? '';
  const body = text.slice(leadingNewlines.length);
  if (!body) return leadingNewlines;

  const unit = indentUnitStr.length > 0 ? indentUnitStr : '  ';
  const tabWidth = tabWidthFromIndentUnit(unit);
  const cursorIndent = cursorIndentAt(prefix);
  const cursorCols = expandIndentToColumns(cursorIndent, tabWidth);

  const lines = body.split('\n');
  const firstLeading = lines[0]?.match(/^[\t ]*/)?.[0] ?? '';
  if (leadingNewlines.length > 0) {
    lines[0] = columnsToIndentUnitStr(cursorCols, unit) + lines[0]!.slice(firstLeading.length);
  } else {
    lines[0] = lines[0]!.slice(firstLeading.length);
  }

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trim()) {
      lines[i] = '';
      continue;
    }
    lines[i] = columnsToIndentUnitStr(cursorCols, unit) + line.trimStart();
  }

  return leadingNewlines + lines.join('\n');
}

/** Remove longest overlaps with document prefix and suffix. */
export function trimOverlapWithDocument(
  text: string,
  prefix: string,
  suffix: string,
): string {
  let result = text;
  const prefixOverlap = longestOverlapSuffixPrefix(prefix, result);
  if (prefixOverlap > 0) {
    result = result.slice(prefixOverlap);
  }
  const suffixOverlap = longestOverlapSuffixPrefix(result, suffix);
  if (suffixOverlap > 0) {
    result = result.slice(0, result.length - suffixOverlap);
  }
  return result;
}

/** Align, validate, and trim model output for inline insertion. */
export function alignAndValidateCompletionText(
  input: AlignCompletionInput,
): AlignCompletionResult {
  let text = stripEditorModelOutput(input.raw);
  if (!text.trim()) {
    return { text: '', rejected: true, reason: 'empty' };
  }

  if (text.startsWith('```')) {
    const lines = text.split('\n');
    if (lines.length > 1 && lines[0].startsWith('```')) {
      lines.shift();
      const last = lines[lines.length - 1];
      if (last?.trim() === '```') lines.pop();
      text = lines.join('\n');
    }
  }

  const cursorIdx = text.indexOf('<CURSOR>');
  if (cursorIdx >= 0) {
    text = text.slice(cursorIdx + '<CURSOR>'.length);
  }

  const explainIdx = text.search(/\n\n(?:Here|This|The following)/i);
  if (explainIdx > 0) {
    text = text.slice(0, explainIdx);
  }

  text = text.replace(/\r\n/g, '\n');
  text = reindentCompletionText(
    text,
    input.prefix,
    input.indentUnitStr ?? '  ',
  );

  if (input.prefix && text.startsWith(input.prefix)) {
    const stripped = text.slice(input.prefix.length);
    if (!stripped.trim()) {
      return { text: '', rejected: true, reason: 'prefix_echo' };
    }
    text = stripped;
  } else if (input.prefix) {
    const tailLen = Math.min(input.prefix.length, 200);
    const tail = input.prefix.slice(-tailLen);
    if (tail.length > 0 && text.startsWith(tail)) {
      const stripped = text.slice(tail.length);
      if (stripped.trim().length > 0) text = stripped;
    }
  }

  text = trimOverlapWithDocument(text, input.prefix, input.suffix);

  const fenceLang = input.fenceLang ?? '';
  const bracketed = alignCompletionBrackets(text, input.prefix, input.suffix, fenceLang);
  if (bracketed.rejected) {
    return { text: '', rejected: true, reason: 'unbalanced' };
  }
  text = bracketed.text;

  if (input.completionMode === 'single') {
    const newlineIdx = text.indexOf('\n');
    if (newlineIdx >= 0) {
      text = text.slice(0, newlineIdx);
    }
  }

  if (!text.trim()) {
    return { text: '', rejected: true, reason: 'empty_after_trim' };
  }
  if (isUnchangedPrefixEcho(text, input.prefix)) {
    return { text: '', rejected: true, reason: 'prefix_echo' };
  }
  if (looksLikeProse(text)) {
    return { text: '', rejected: true, reason: 'prose' };
  }

  const maxChars = input.maxInsertChars ?? DEFAULT_MAX_INSERT_CHARS;
  if (text.length > maxChars) {
    return { text: '', rejected: true, reason: 'oversized' };
  }

  const combined = input.prefix + text + input.suffix;
  const docLen = input.prefix.length + input.suffix.length;
  if (text.length > docLen * 0.85 && combined.length > 400) {
    return { text: '', rejected: true, reason: 'full_rewrite' };
  }

  return { text: text.trimEnd(), rejected: false };
}

/**
 * @deprecated Use {@link alignAndValidateCompletionText}.
 */
export function sanitizeCompletionText(raw: string, docPrefix?: string): string {
  return alignAndValidateCompletionText({
    raw,
    prefix: docPrefix ?? '',
    suffix: '',
  }).text;
}

/** True when a streamed partial should replace the current ghost (monotonic + valid). */
export function shouldReplaceGhostPartial(
  current: string,
  next: string,
  prefix: string,
  suffix: string,
): boolean {
  if (!next) return false;
  const aligned = alignAndValidateCompletionText({ raw: next, prefix, suffix });
  if (aligned.rejected || !aligned.text) return false;
  if (!current) return true;
  if (aligned.text.length < current.length) return false;
  return aligned.text.startsWith(current);
}

/** Next chunk for partial ghost accept (word or first line). */
export function nextPartialGhostChunk(ghostText: string): string {
  if (!ghostText) return '';
  if (ghostText.startsWith('\n')) return '\n';
  const lineBreak = ghostText.indexOf('\n');
  if (lineBreak > 0 && lineBreak <= 120) {
    return ghostText.slice(0, lineBreak + 1);
  }
  const match = ghostText.match(/^(\S+\s?|\s+)/);
  return match ? match[1] : ghostText.charAt(0);
}
