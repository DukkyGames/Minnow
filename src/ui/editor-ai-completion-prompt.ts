/**
 * FIM-style prompt builder for editor AI inline completions (POLISH-006).
 */

import type { EditorState } from '@codemirror/state';
import type { ApiMessage } from '../types';
import type { EditorAiCompletionConfig } from '../config/editor-ai-completion';

export const EDITOR_AI_COMPLETION_SYSTEM =
  'You are a code completion engine. Output only the text that should appear at the cursor. ' +
  'No explanations, markdown fences, or comments unless they belong at the insertion point.';

export interface EditorAiPromptInput {
  state: EditorState;
  cursorPos: number;
  filePath: string;
  config: EditorAiCompletionConfig;
}

export interface EditorAiPromptResult {
  messages: ApiMessage[];
  prefix: string;
  suffix: string;
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
  const userBody = [
    `File: ${pathLine}`,
    `Language: ${language}`,
    '---',
    prefix,
    '<CURSOR>',
    suffix,
  ].join('\n');

  const messages: ApiMessage[] = [
    { role: 'system', content: EDITOR_AI_COMPLETION_SYSTEM },
    { role: 'user', content: userBody },
  ];

  return { messages, prefix, suffix };
}

/**
 * Normalize model output for inline insertion (strip fences / chatter).
 * When `docPrefix` is set, drop a leading copy of text already before the cursor.
 */
export function sanitizeCompletionText(raw: string, docPrefix?: string): string {
  let text = raw.replace(/^\s+/, '');
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
