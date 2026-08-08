/**
 * Regression guard: eager boot graph must not value-import CodeMirror or xterm.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const ENTRY = path.join(SRC_ROOT, 'main.ts');

const FORBIDDEN_PREFIXES = ['@codemirror/', '@xterm/'] as const;

function isForbiddenSpecifier(specifier: string): boolean {
  return FORBIDDEN_PREFIXES.some((prefix) => specifier.startsWith(prefix));
}

function resolveLocalModule(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/** True when a named import clause has at least one value binding. */
function namedImportClauseHasValue(clause: string): boolean {
  const trimmed = clause.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return true;
  const inner = trimmed.slice(1, -1);
  return inner.split(',').some((part) => {
    const token = part.trim();
    if (!token) return false;
    return !token.startsWith('type ');
  });
}

/** Whether a static import/export-from loads its module at runtime (skip `import type`). */
function importClauseLoadsModule(clause: string, typeOnlyPrefix: boolean): boolean {
  if (typeOnlyPrefix) return false;
  const trimmed = clause.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('{')) return namedImportClauseHasValue(trimmed);
  if (trimmed.startsWith('*')) return true;
  return true;
}

function collectEagerSpecifiers(filePath: string): string[] {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const specifiers: string[] = [];

  const importFromRe =
    /^\s*import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/gm;
  for (const match of sourceText.matchAll(importFromRe)) {
    const typeOnly = Boolean(match[1]);
    const clause = match[2] ?? '';
    const specifier = match[3] ?? '';
    if (importClauseLoadsModule(clause, typeOnly)) {
      specifiers.push(specifier);
    }
  }

  const sideEffectImportRe = /^\s*import\s+['"]([^'"]+)['"]\s*;?/gm;
  for (const match of sourceText.matchAll(sideEffectImportRe)) {
    specifiers.push(match[1] ?? '');
  }

  const exportFromRe =
    /^\s*export\s+(type\s+)?[\s\S]*?\s+from\s+['"]([^'"]+)['"]\s*;?/gm;
  for (const match of sourceText.matchAll(exportFromRe)) {
    if (match[1]) continue;
    specifiers.push(match[2] ?? '');
  }

  return specifiers;
}

function walkEagerGraph(entry: string): { files: Set<string>; violations: { file: string; specifier: string }[] } {
  const queue = [entry];
  const seen = new Set<string>();
  const violations: { file: string; specifier: string }[] = [];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const specifiers = collectEagerSpecifiers(file);
    for (const specifier of specifiers) {
      if (isForbiddenSpecifier(specifier)) {
        violations.push({ file, specifier });
        continue;
      }
      const resolved = resolveLocalModule(file, specifier);
      if (resolved) queue.push(resolved);
    }
  }

  return { files: seen, violations };
}

describe('eager boot graph', () => {
  it('does not value-import @codemirror/* or @xterm/* from src/main.ts', () => {
    assert.ok(fs.existsSync(ENTRY), `missing entry ${ENTRY}`);
    const { violations } = walkEagerGraph(ENTRY);
    assert.deepEqual(
      violations,
      [],
      violations.length
        ? `forbidden eager imports:\n${violations
            .map((v) => `  ${path.relative(REPO_ROOT, v.file)} → ${v.specifier}`)
            .join('\n')}`
        : undefined,
      );
  });

  it('does not side-effect-import deferred feature CSS from src/main.ts', () => {
    const sourceText = fs.readFileSync(ENTRY, 'utf8');
    const forbiddenCss = [
      'file-panel.css',
      'file-type-icons.css',
      'git-commit-diff.css',
      'terminal.css',
      'source-control-center.css',
      'orchestrate-board.css',
      'orchestrate-hub.css',
      'orchestrate-plan-screen.css',
      'super-plan-page.css',
      'code-overview.css',
      'models-page.css',
      'onboarding.css',
      'hub.css',
      'orchestrate-plan-selector.css',
    ];
    const sideEffectCss = [
      ...sourceText.matchAll(/^\s*import\s+['"]([^'"]+\.css)['"]\s*;?/gm),
    ].map((m) => m[1] ?? '');
    const hits = forbiddenCss.filter((name) =>
      sideEffectCss.some((spec) => spec.endsWith(name) || spec.includes(`/${name}`)),
    );
    assert.deepEqual(hits, [], `deferred CSS still imported from main.ts: ${hits.join(', ')}`);
  });
});
