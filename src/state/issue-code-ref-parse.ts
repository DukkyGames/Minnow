/**
 * Pure helpers for IssueCodeRef paste strings (MIN-261 Phase 2).
 * Accepts `path`, `path:12`, or `path:12-34` (Windows backslashes ok).
 */

import type { IssueCodeRef } from '../types.ts';

export type ParseIssueCodeRefPasteResult =
  | { ok: true; ref: IssueCodeRef }
  | { ok: false; error: string };

/**
 * Parse a user-pasted code link: `src/foo.ts`, `src/foo.ts:12`, or `src/foo.ts:12-34`.
 */
export function parseIssueCodeRefPaste(raw: string): ParseIssueCodeRefPasteResult {
  const trimmed = raw.trim().replace(/\\/g, '/');
  if (!trimmed) return { ok: false, error: 'Empty code link' };

  const rangeMatch = /^(.*):(\d+)(?:-(\d+))?$/.exec(trimmed);
  if (!rangeMatch) {
    return { ok: true, ref: { path: trimmed } };
  }

  const path = rangeMatch[1]?.trim() ?? '';
  if (!path || /^[A-Za-z]$/.test(path)) {
    return { ok: true, ref: { path: trimmed } };
  }

  const startLine = Number(rangeMatch[2]);
  const endRaw = rangeMatch[3];
  const endLine = endRaw != null ? Number(endRaw) : startLine;
  if (!Number.isFinite(startLine) || startLine < 1) {
    return { ok: false, error: 'Invalid start line' };
  }
  if (!Number.isFinite(endLine) || endLine < startLine) {
    return { ok: false, error: 'Invalid end line' };
  }

  return {
    ok: true,
    ref: {
      path,
      startLine: Math.floor(startLine),
      endLine: Math.floor(endLine),
    },
  };
}
