/**
 * Phase 1 Reef Widget Library — template markdown conventions.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { getBuiltinReefWidgetsDir } from '../../../server/reef/widget-paths.js';

/** New widget templates shipped in Phase 1. */
const PHASE1_WIDGET_FILES = [
  'checklist.md',
  'stats-dashboard.md',
  'pie-chart.md',
  'heatmap.md',
  'quiz.md',
  'qa-callllm.md',
  'timeline.md',
  'unit-converter.md',
];

const HEX_COLOR_RE = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

function widgetPath(name) {
  return path.join(getBuiltinReefWidgetsDir(), name);
}

function readWidget(name) {
  const filePath = widgetPath(name);
  assert.ok(fs.existsSync(filePath), `missing widget template: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function assertReefWidgetFence(content, name) {
  assert.match(
    content,
    /```reef-widget[\s\S]*?```/,
    `${name}: expected a closed \`\`\`reef-widget fence`,
  );
}

function assertNoHexColors(content, name) {
  const match = content.match(HEX_COLOR_RE);
  assert.equal(match, null, `${name}: hex color not allowed (${match?.[0]})`);
}

function assertUsesCssVars(content, name) {
  assert.match(content, /var\(--/, `${name}: expected var(--*) theme tokens`);
}

function assertMaxWidth680(content, name) {
  const has680 =
    /max-width:\s*680px/i.test(content) ||
    /\b680px\b/.test(content);
  assert.ok(has680, `${name}: expected max-width: 680px or 680px in styles`);
}

function assertForbiddenPatterns(content, name) {
  assert.doesNotMatch(
    content,
    /position:\s*fixed/i,
    `${name}: position: fixed is not allowed`,
  );
  assert.doesNotMatch(
    content,
    /\blocalStorage\b/,
    `${name}: localStorage is not allowed`,
  );
  assert.doesNotMatch(
    content,
    /\bsessionStorage\b/,
    `${name}: sessionStorage is not allowed`,
  );
}

describe('reef widget template conventions (Phase 1)', () => {
  for (const name of PHASE1_WIDGET_FILES) {
    test(`${name} follows reef-widget markdown conventions`, () => {
      const content = readWidget(name);
      assertReefWidgetFence(content, name);
      assertNoHexColors(content, name);
      assertUsesCssVars(content, name);
      assertMaxWidth680(content, name);
      assertForbiddenPatterns(content, name);
    });
  }

  test('pie-chart.md uses React/Recharts or PieChart', () => {
    const content = readWidget('pie-chart.md');
    const hasRecharts =
      /from\s+['"]recharts['"]/i.test(content) ||
      /\bPieChart\b/.test(content) ||
      (/import\s+React/i.test(content) && /recharts/i.test(content));
    assert.ok(hasRecharts, 'pie-chart.md: expected React/Recharts import or PieChart reference');
  });

  test('qa-callllm.md exposes callLLM and onChunk', () => {
    const content = readWidget('qa-callllm.md');
    assert.match(content, /\bcallLLM\b/, 'qa-callllm.md: expected callLLM usage');
    assert.match(content, /\bonChunk\b/, 'qa-callllm.md: expected onChunk handler');
  });
});
