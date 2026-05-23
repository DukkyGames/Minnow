import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  aggregateRunScore,
  aggregateSuiteScore,
  exactMatch,
  parseJudgeJson,
  toolNameMatch,
} from '../../src/benchmark/scoring.ts';

describe('benchmark scoring', () => {
  test('exactMatch trims whitespace', () => {
    assert.equal(exactMatch('  hello  ', 'hello'), true);
  });

  test('toolNameMatch finds expected tool', () => {
    assert.equal(
      toolNameMatch([{ function: { name: 'read_file', arguments: '{}' } }], 'read_file'),
      true,
    );
  });

  test('parseJudgeJson extracts verdict', () => {
    const v = parseJudgeJson('Here: {"pass":true,"reason":"ok"}');
    assert.equal(v.pass, true);
    assert.equal(v.reason, 'ok');
  });

  test('aggregateSuiteScore averages scores', () => {
    assert.equal(aggregateSuiteScore([1, 0.5, 0]), 0.5);
  });

  test('aggregateRunScore weights by test count', () => {
    const score = aggregateRunScore([
      { score: 1, tests: [{ skipped: false }, { skipped: false }] },
      { score: 0, tests: [{ skipped: false }] },
    ]);
    assert.equal(score, 2 / 3);
  });
});
