/**
 * Apply streamed Quick Edit replacements to a document range (Phase 4).
 */

import {
  buildLineDiff,
  countLineChangeStats,
  type DiffLine,
} from '../../chat/prompts/text-diff';

/** Replace doc[from..to) with replacement text; returns updated full document. */
export function applyReplacementInRange(
  doc: string,
  from: number,
  to: number,
  replacement: string,
): string {
  if (from < 0 || to < from || to > doc.length) {
    return doc;
  }
  return doc.slice(0, from) + replacement + doc.slice(to);
}

/** Strip markdown fences and chatter from a model edit response. */
export function sanitizeQuickEditText(raw: string, originalText?: string): string {
  let text = raw.replace(/^\s+/, '').replace(/\s+$/, '');
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

  if (originalText && text === originalText) {
    return text;
  }

  const explainIdx = text.search(/\n\n(?:Here|This|The following|I've|I have)/i);
  if (explainIdx > 0) {
    text = text.slice(0, explainIdx);
  }

  return text.replace(/\r\n/g, '\n');
}

/** Build inline diff rows for the quick-edit panel from before/after text. */
export function buildQuickEditDiffLines(before: string, after: string): DiffLine[] {
  return buildLineDiff(before, after);
}

/** Count +/- lines for the quick-edit header badge. */
export function countQuickEditStats(
  before: string,
  after: string,
): { additions: number; deletions: number } {
  return countLineChangeStats(before, after);
}
