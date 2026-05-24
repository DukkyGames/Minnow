/**
 * Phase 2 Reef Widget Library — snippet markdown conventions.
 * Snippets are copy-paste building blocks without title chrome (<h2>).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { getBuiltinReefWidgetsDir } from '../../../server/reef/widget-paths.js';

/** Phase 2 snippet templates (filename must use snippet- prefix). */
const PHASE2_SNIPPET_FILES = [
  'snippet-chart-line.md',
  'snippet-chart-bar.md',
  'snippet-table.md',
  'snippet-stat-card.md',
  'snippet-input-row.md',
  'snippet-sparkline.md',
];

/** Recharts-based chart snippets (sparkline is SVG-only, tested separately). */
const RECHARTS_CHART_SNIPPET_FILES = [
  'snippet-chart-line.md',
  'snippet-chart-bar.md',
];

const HEX_COLOR_RE = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

function widgetPath(name) {
  return path.join(getBuiltinReefWidgetsDir(), name);
}

function readWidget(name) {
  const filePath = widgetPath(name);
  assert.ok(fs.existsSync(filePath), `missing snippet template: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

/** Body inside the first closed reef-widget fence (CRLF-safe). */
function extractReefWidgetFenceBody(content) {
  const match = content.match(/```reef-widget\r?\n([\s\S]*?)```/);
  return match ? match[1] : null;
}

function assertSnippetFilename(name) {
  assert.match(name, /^snippet-[\w-]+\.md$/, `${name}: filename must use snippet- prefix`);
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

function assertNoH2InFence(fenceBody, name) {
  assert.doesNotMatch(
    fenceBody,
    /<h2\b/i,
    `${name}: snippets must not include <h2> title chrome in fence body`,
  );
}

function assertChartSnippetConventions(fenceBody, name) {
  assert.match(fenceBody, /\.rw-chart\b/, `${name}: chart snippet expected .rw-chart class`);
  const hasResize =
    /\brequestResize\b/.test(fenceBody) || /\buseLayoutEffect\b/.test(fenceBody);
  assert.ok(
    hasResize,
    `${name}: chart snippet expected requestResize or useLayoutEffect`,
  );
  assert.doesNotMatch(
    fenceBody,
    /\btoExponential\s*\(/i,
    `${name}: chart snippet must not use toExponential on axis ticks`,
  );
  assert.match(
    fenceBody,
    /type:\s*['"]number['"]|type\s*=\s*["']number["']/,
    `${name}: YAxis must declare type number`,
  );
  assert.match(
    fenceBody,
    /\bwidth:\s*60\b|\bwidth\s*=\s*\{?\s*60\b/,
    `${name}: YAxis must set width 60`,
  );
  assert.match(
    fenceBody,
    /left:\s*3[6-9]\b|left:\s*[4-9]\d\b/,
    `${name}: chart margin.left must be at least 36`,
  );
}

describe('reef widget snippet conventions (Phase 2)', () => {
  for (const name of PHASE2_SNIPPET_FILES) {
    test(`${name} follows snippet markdown conventions`, () => {
      assertSnippetFilename(name);
      const content = readWidget(name);
      assertReefWidgetFence(content, name);
      assertNoHexColors(content, name);
      assertUsesCssVars(content, name);

      const fenceBody = extractReefWidgetFenceBody(content);
      assert.ok(fenceBody, `${name}: could not extract reef-widget fence body`);
      assertNoH2InFence(fenceBody, name);
    });
  }

  for (const name of RECHARTS_CHART_SNIPPET_FILES) {
    test(`${name} chart snippet has resize hook and chart surface`, () => {
      const content = readWidget(name);
      const fenceBody = extractReefWidgetFenceBody(content);
      assert.ok(fenceBody);
      assertChartSnippetConventions(fenceBody, name);
    });
  }

  test('snippet-sparkline.md uses SVG polyline', () => {
    const content = readWidget('snippet-sparkline.md');
    const fenceBody = extractReefWidgetFenceBody(content);
    assert.ok(fenceBody);
    assert.match(
      fenceBody,
      /<polyline\b/i,
      'snippet-sparkline.md: expected <polyline> in fence body',
    );
  });
});
