/**
 * Deterministic scoring for skill benchmark probes (BUG-009).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import builtinManifest from '../../src/skills/builtin-manifest.json';
import {
  evaluateSkillProbe,
  getSkillProbe,
  listSkillProbeIds,
  SKILL_PROBES,
} from '../../src/benchmark/suites/skill-probes.ts';
import type { ToolCall } from '../../src/types.ts';

function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: 'call-1',
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

describe('skill probes', () => {
  test('manifest built-ins each have an explicit probe', () => {
    const manifestIds = (builtinManifest.skills ?? []).map((s) => s.id).sort();
    const probeIds = listSkillProbeIds().sort();
    assert.deepEqual(probeIds, manifestIds);
    for (const id of manifestIds) {
      assert.ok(SKILL_PROBES[id], `missing probe for ${id}`);
    }
  });

  test('ask-user passes on valid ask_question tool call', () => {
    const probe = getSkillProbe('ask-user');
    const out = evaluateSkillProbe(probe, {
      text: '',
      toolCalls: [
        toolCall('ask_question', {
          questions: [
            {
              id: 'api-style',
              prompt: 'Primary API style?',
              options: [
                { id: 'rest', label: 'REST' },
                { id: 'graphql', label: 'GraphQL' },
              ],
            },
          ],
        }),
      ],
    });
    assert.equal(out.passed, true);
  });

  test('ask-user fails on acknowledgment prose only', () => {
    const probe = getSkillProbe('ask-user');
    const out = evaluateSkillProbe(probe, {
      text: 'Understood. I will ask clarifying questions when needed.',
      toolCalls: [],
    });
    assert.equal(out.passed, false);
  });

  test('code-review passes on skill output sections', () => {
    const probe = getSkillProbe('code-review');
    const out = evaluateSkillProbe(probe, {
      text: '## Summary\nDivision by zero risk.\n\n## Blockers\n- No guard for b === 0',
      toolCalls: [],
    });
    assert.equal(out.passed, true);
  });

  test('code-review fails on bare acknowledgment', () => {
    const probe = getSkillProbe('code-review');
    const out = evaluateSkillProbe(probe, {
      text: 'Understood. I acknowledge the Code Review skill instructions.',
      toolCalls: [],
    });
    assert.equal(out.passed, false);
  });

  test('git-commit passes on conventional subject in text', () => {
    const probe = getSkillProbe('git-commit');
    const out = evaluateSkillProbe(probe, {
      text: 'fix: guard divide by zero when divisor is 0',
      toolCalls: [],
    });
    assert.equal(out.passed, true);
  });

  test('regex probes fail on empty text', () => {
    const probe = getSkillProbe('explain-code');
    const out = evaluateSkillProbe(probe, { text: '', toolCalls: [] });
    assert.equal(out.passed, false);
    assert.match(out.details, /empty response/);
  });
});
