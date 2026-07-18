/**
 * Confidence-split routing, project-track categories, and extraction context.
 *
 * Background: a single `requireConfirmation` flag forced every fact through the
 * same door — the queue rotted unreviewed or hedged guesses got written as fact.
 * Routing is by confidence now. Also pins the fix for formatMessagesForExtraction
 * re-slicing its caller's window down to the personal-fact default.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  CONTEXT_WINDOW,
  FACT_BODY_MAX_CHARS,
  PROJECT_CATEGORIES,
  formatMessagesForExtraction,
  normalizeExtractedFact,
  routeSynthesisFact,
  synthesisFactDir,
} from '../../server/brain/synthesis.js';
import { DEFAULT_SYNTHESIS_CONFIG } from '../../server/brain/synthesis-config.js';

const CFG = {
  confidenceThreshold: 0.6,
  autoWriteConfidence: 0.85,
  requireConfirmation: false,
};

describe('routeSynthesisFact', () => {
  test('below the confidence floor is dropped', () => {
    assert.equal(routeSynthesisFact({ confidence: 0.4 }, CFG), 'skip-low');
    assert.equal(routeSynthesisFact({ confidence: 0.59 }, CFG), 'skip-low');
  });

  test('between the floor and the auto-write bar becomes a proposal', () => {
    assert.equal(routeSynthesisFact({ confidence: 0.6 }, CFG), 'propose');
    assert.equal(routeSynthesisFact({ confidence: 0.84 }, CFG), 'propose');
  });

  test('at or above the auto-write bar is written directly', () => {
    assert.equal(routeSynthesisFact({ confidence: 0.85 }, CFG), 'write');
    assert.equal(routeSynthesisFact({ confidence: 1 }, CFG), 'write');
  });

  test('requireConfirmation forces review even at full confidence', () => {
    assert.equal(
      routeSynthesisFact({ confidence: 1 }, { ...CFG, requireConfirmation: true }),
      'propose',
    );
  });

  test('requireConfirmation does not rescue a low-confidence fact', () => {
    assert.equal(
      routeSynthesisFact({ confidence: 0.2 }, { ...CFG, requireConfirmation: true }),
      'skip-low',
    );
  });

  test('missing confidence is treated as zero', () => {
    assert.equal(routeSynthesisFact({}, CFG), 'skip-low');
  });

  test('falls back to shipped defaults when config is empty', () => {
    assert.equal(routeSynthesisFact({ confidence: 0.9 }, {}), 'write');
    assert.equal(routeSynthesisFact({ confidence: 0.7 }, {}), 'propose');
    assert.equal(routeSynthesisFact({ confidence: 0.1 }, {}), 'skip-low');
  });
});

describe('synthesis config defaults', () => {
  test('auto-write bar sits above the confidence floor', () => {
    assert.ok(
      DEFAULT_SYNTHESIS_CONFIG.autoWriteConfidence >
        DEFAULT_SYNTHESIS_CONFIG.confidenceThreshold,
    );
  });

  test('confirmation is off by default', () => {
    assert.equal(DEFAULT_SYNTHESIS_CONFIG.requireConfirmation, false);
  });
});

describe('normalizeExtractedFact', () => {
  test('accepts project-track categories', () => {
    for (const category of PROJECT_CATEGORIES) {
      const fact = normalizeExtractedFact({ title: 'T', body: 'B', category });
      assert.equal(fact.category, category, category);
    }
  });

  test('project categories default to workspace scope', () => {
    const fact = normalizeExtractedFact({ title: 'T', body: 'B', category: 'gotcha' });
    assert.equal(fact.scope, 'workspace');
  });

  test('personal categories default to personal scope', () => {
    const fact = normalizeExtractedFact({ title: 'T', body: 'B', category: 'preference' });
    assert.equal(fact.scope, 'personal');
  });

  test('explicit scope wins over the category default', () => {
    const fact = normalizeExtractedFact({
      title: 'T',
      body: 'B',
      category: 'gotcha',
      scope: 'personal',
    });
    assert.equal(fact.scope, 'personal');
  });

  test('unknown category falls back to fact/personal', () => {
    const fact = normalizeExtractedFact({ title: 'T', body: 'B', category: 'nonsense' });
    assert.equal(fact.category, 'fact');
    assert.equal(fact.scope, 'personal');
  });

  test('body is capped, not truncated to one sentence', () => {
    const fact = normalizeExtractedFact({ title: 'T', body: 'x'.repeat(1000) });
    assert.equal(fact.body.length, FACT_BODY_MAX_CHARS);
  });

  test('still rejects secrets', () => {
    assert.equal(
      normalizeExtractedFact({ title: 'Deploy key', body: 'password is hunter2' }),
      null,
    );
  });
});

describe('synthesisFactDir', () => {
  test('personal-scope facts go to the shared tree', () => {
    assert.equal(synthesisFactDir({ scope: 'personal' }), 'facts');
  });

  test('unscoped facts go to the shared tree', () => {
    assert.equal(synthesisFactDir({}), 'facts');
  });

  test('workspace-scope resolves to a workspaces/ path or falls back to facts', () => {
    const dir = synthesisFactDir({ scope: 'workspace' });
    assert.ok(
      dir === 'facts' || dir.startsWith('workspaces/'),
      `unexpected dir: ${dir}`,
    );
  });
});

describe('formatMessagesForExtraction', () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message ${i}`,
  }));

  test('defaults preserve the original window', () => {
    const out = formatMessagesForExtraction(messages);
    assert.equal(out.split('\n').length, CONTEXT_WINDOW);
    assert.ok(out.includes('message 29'));
    assert.ok(!out.includes('message 23'));
  });

  test('a wider window is honored, not re-sliced (regression)', () => {
    const out = formatMessagesForExtraction(messages, { window: 20 });
    assert.equal(out.split('\n').length, 20);
    assert.ok(out.includes('message 10'));
  });

  test('per-message truncation is configurable', () => {
    const long = [{ role: 'user', content: 'y'.repeat(2000) }];
    assert.ok(formatMessagesForExtraction(long).length < 600);
    assert.ok(formatMessagesForExtraction(long, { perMessageChars: 1500 }).length > 1400);
  });

  test('role filter drops other roles', () => {
    const mixed = [
      { role: 'user', content: 'keep me' },
      { role: 'tool', content: 'drop me' },
      { role: 'assistant', content: 'keep me too' },
    ];
    const out = formatMessagesForExtraction(mixed, { roles: ['user', 'assistant'] });
    assert.ok(!out.includes('drop me'));
    assert.ok(out.includes('keep me'));
    assert.ok(out.includes('keep me too'));
  });

  test('empty input yields an empty transcript', () => {
    assert.equal(formatMessagesForExtraction([]), '');
  });
});
