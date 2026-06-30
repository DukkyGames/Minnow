/**
 * Static checks for plan-reviewer sub-agent prompts (Super Plan Phase 5).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SHIPPED_SUB_AGENT_PROMPTS } from '../../src/agents/shipped-sub-agent-prompts.ts';

describe('plan-reviewer sub-agent prompts', () => {
  test('SHIPPED_SUB_AGENT_PROMPTS plan-reviewer.full is populated', () => {
    const body = SHIPPED_SUB_AGENT_PROMPTS['plan-reviewer.full']?.trim() ?? '';
    assert.ok(body.length > 0, 'plan-reviewer.full shipped prompt must be non-empty');
    assert.ok(body.includes('Pass 1'), 'must describe pass 1 behavior');
    assert.ok(body.includes('Pass 2'), 'must describe pass 2 behavior');
    assert.ok(body.includes('suggested fix'), 'must require suggested fixes in findings');
    assert.ok(body.includes('read-only'), 'must enforce read-only constraints');
  });

  test('plan-reviewer.lite summarizes contract', () => {
    const body = SHIPPED_SUB_AGENT_PROMPTS['plan-reviewer.lite']?.trim() ?? '';
    assert.ok(body.includes('Pass 2'));
    assert.ok(body.includes('findings'));
  });
});
