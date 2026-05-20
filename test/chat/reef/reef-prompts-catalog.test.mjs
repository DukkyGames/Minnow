/**
 * Reef mode prompts must catalog all widget templates and snippet composables.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODES_DIR = path.join(__dirname, '../../../src/chat/prompts/modes');

/** Phase 1 full templates added to the reef.full.md table. */
const PHASE1_TEMPLATE_PATHS = [
  'checklist.md',
  'stats-dashboard.md',
  'pie-chart.md',
  'heatmap.md',
  'quiz.md',
  'qa-callllm.md',
  'timeline.md',
  'unit-converter.md',
];

function readPrompt(name) {
  return fs.readFileSync(path.join(MODES_DIR, name), 'utf8');
}

function assertTemplatePathsInFull(content) {
  for (const file of PHASE1_TEMPLATE_PATHS) {
    const pathRef = `@minnow/reef/widgets/${file}`;
    assert.ok(
      content.includes(pathRef),
      `reef.full.md must include template path ${pathRef}`,
    );
  }
}

describe('reef prompts catalog', () => {
  test('reef.full.md lists Phase 1 templates and Snippets section', () => {
    const content = readPrompt('reef.full.md');

    assertTemplatePathsInFull(content);

    assert.match(
      content,
      /##?\s*Snippets|Snippets\s*=|snippet-\*\.md/i,
      'reef.full.md must document Snippets (section or prose)',
    );
    assert.ok(
      content.includes('snippet-chart-line'),
      'reef.full.md must mention snippet-chart-line',
    );
    assert.ok(
      content.includes('snippet-*.md'),
      'reef.full.md must mention snippet-*.md pattern',
    );
  });

  test('reef.lite.md mentions snippet-*.md composables', () => {
    const content = readPrompt('reef.lite.md');
    assert.ok(
      content.includes('snippet-*.md'),
      'reef.lite.md must mention snippet-*.md',
    );
  });
});
