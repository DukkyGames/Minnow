/**
 * Static checks for Research mode four-phase pipeline and researcher worker prompts.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SHIPPED_SUB_AGENT_PROMPTS } from '../../src/agents/shipped-sub-agent-prompts.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESEARCH_FULL = path.join(
  __dirname,
  '../../src/chat/prompts/modes/research.full.md',
);

function readUtf8(p) {
  return fs.readFileSync(p, 'utf8');
}

describe('research mode pipeline prompts', () => {
  test('research.full.md documents orchestration contract', () => {
    const content = readUtf8(RESEARCH_FULL);
    assert.ok(content.includes('ask_question'), 'must mention ask_question');
    assert.ok(
      content.includes('spawn_sub_agent'),
      'must mention spawn_sub_agent',
    );
    assert.ok(
      content.includes('"researcher"'),
      'must document researcher sub-agent type',
    );
    assert.ok(
      content.includes('"wait": false') || content.includes('wait: false'),
      'must document wait false for overlapping runs',
    );
    assert.ok(content.includes('## References'), 'template must include ## References');
    assert.ok(content.includes('version: 3'), 'frontmatter version should be 3');
  });

  test('SHIPPED_SUB_AGENT_PROMPTS researcher.full is populated', () => {
    const body = SHIPPED_SUB_AGENT_PROMPTS['researcher.full']?.trim() ?? '';
    assert.ok(body.length > 0, 'researcher.full shipped prompt must be non-empty');
    assert.ok(body.includes('## Findings'), 'worker contract must include Findings');
    assert.ok(body.includes('## Sources'), 'worker contract must include Sources');
  });
});
