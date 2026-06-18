/**
 * FIM-style prompt builder for editor AI inline completions (POLISH-006, Phase 4).
 */

import type { EditorState } from '@codemirror/state';
import type { ApiMessage } from '../types';
import type { EditorAiCompletionConfig } from '../config/editor-ai-completion';
import { stripEditorModelOutput } from './editor-model-output';

export const EDITOR_AI_COMPLETION_SYSTEM =
  'You are a code completion engine. Output only the text that should appear at the cursor. ' +
  'No explanations, markdown fences, thinking tags, or comments unless they belong at the insertion point. ' +
  'Never wrap output in reasoning or thinking markup.';

/** Qwen Coder native fill-in-the-middle token markers. */
export const QWEN_FIM_PREFIX = '<|fim_prefix|>';
export const QWEN_FIM_SUFFIX = '<|fim_suffix|>';
export const QWEN_FIM_MIDDLE = '<|fim_middle|>';

export interface EditorAiPromptInput {
  state: EditorState;
  cursorPos: number;
  filePath: string;
  config: EditorAiCompletionConfig;
  /** Active model id — used to pick native FIM when supported. */
  modelId?: string;
  /** Optional LSP hover markdown/plain text for the cursor symbol. */
  lspHover?: string | null;
}

export interface EditorAiPromptResult {
  messages: ApiMessage[];
  prefix: string;
  suffix: string;
  /** When true, client should send `prompt` (native FIM) instead of chat messages. */
  useNativeFim: boolean;
  /** Native FIM prompt string for Qwen-style models. */
  fimPrompt?: string;
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

/** True when the model id suggests Qwen Coder native FIM support. */
export function isQwenFimModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (!id.includes('qwen')) return false;
  return (
    id.includes('coder') ||
    id.includes('code') ||
    id.includes('2.5') ||
    id.includes('2-5') ||
    id.includes('3-coder') ||
    id.includes('3coder')
  );
}

/** Build Qwen native FIM prompt (prefix + suffix around cursor). */
export function buildQwenFimPrompt(prefix: string, suffix: string): string {
  return `${QWEN_FIM_PREFIX}${prefix}${QWEN_FIM_SUFFIX}${suffix}${QWEN_FIM_MIDDLE}`;
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
  const lineIndex = line.number - 1;

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
  const modelId = input.modelId?.trim() ?? '';
  const useNativeFim =
    input.config.useNativeFim !== false && isQwenFimModel(modelId);

  if (useNativeFim) {
    return {
      messages: [],
      prefix,
      suffix,
      useNativeFim: true,
      fimPrompt: buildQwenFimPrompt(prefix, suffix),
    };
  }

  const contextBlocks: string[] = [];
  if (input.config.includeImportContext !== false) {
    const imports = extractImportSymbols(input.state.doc.toString());
    if (imports.trim()) {
      contextBlocks.push('Imports / requires:\n' + imports);
    }
  }
  if (input.config.includeLspHover !== false && input.lspHover?.trim()) {
    contextBlocks.push('Symbol at cursor (LSP hover):\n' + input.lspHover.trim());
  }

  const userBody = [
    `File: ${pathLine}`,
    `Language: ${language}`,
    ...(contextBlocks.length > 0 ? ['---', ...contextBlocks, '---'] : ['---']),
    prefix,
    '<CURSOR>',
    suffix,
  ].join('\n');

  const messages: ApiMessage[] = [
    { role: 'system', content: EDITOR_AI_COMPLETION_SYSTEM },
    { role: 'user', content: userBody },
  ];

  return { messages, prefix, suffix, useNativeFim: false };
}

/**
 * Build prompt payload with optional async LSP hover (try/catch — never throws).
 */
export async function buildEditorAiCompletionMessagesAsync(
  input: EditorAiPromptInput,
): Promise<EditorAiPromptResult> {
  let lspHover: string | null = null;
  if (input.config.includeLspHover !== false) {
    try {
      const { fetchLspHover } = await import('../lsp/hover-client');
      const lineInfo = input.state.doc.lineAt(input.cursorPos);
      lspHover = await fetchLspHover(
        input.filePath,
        lineInfo.number - 1,
        input.cursorPos - lineInfo.from,
      );
    } catch {
      lspHover = null;
    }
  }
  return buildEditorAiCompletionMessages({ ...input, lspHover });
}

/**
 * Normalize model output for inline insertion (strip fences / chatter).
 * When `docPrefix` is set, drop a leading copy of text already before the cursor.
 */
export function sanitizeCompletionText(raw: string, docPrefix?: string): string {
  let text = stripEditorModelOutput(raw);
  text = text.replace(/^\s+/, '');
  if (!text) return '';

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

  if (docPrefix && docPrefix.length > 0) {
    const tailLen = Math.min(docPrefix.length, 200);
    const tail = docPrefix.slice(-tailLen);
    if (text.startsWith(docPrefix)) {
      const stripped = text.slice(docPrefix.length);
      if (stripped.trim().length > 0) text = stripped;
    } else if (tail.length > 0 && text.startsWith(tail)) {
      const stripped = text.slice(tail.length);
      if (stripped.trim().length > 0) text = stripped;
    }
  }

  return text.trimEnd();
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
