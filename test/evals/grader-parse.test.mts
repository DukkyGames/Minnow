/**
 * Grader JSON parse tests.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseGraderJson } from '../../src/evals/grader-parse.ts';

describe('parseGraderJson', () => {
  it('parses valid JSON', () => {
    const raw = '{"score":100,"pass":true,"rationale":"All good"}';
    const result = parseGraderJson(raw);
    assert.equal(result.score, 100);
    assert.equal(result.pass, true);
    assert.equal(result.rationale, 'All good');
  });

  it('falls back on malformed output', () => {
    const result = parseGraderJson('not json at all');
    assert.equal(result.score, 0);
    assert.equal(result.pass, false);
    assert.match(result.rationale, /malformed/i);
  });

  it('extracts JSON from fenced block', () => {
    const raw = '```json\n{"score":50,"pass":false,"rationale":"Partial"}\n```';
    const result = parseGraderJson(raw);
    assert.equal(result.score, 50);
    assert.equal(result.pass, false);
  });
});
