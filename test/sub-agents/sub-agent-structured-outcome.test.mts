import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  extractJsonTextFromAssistantBody,
  parseStructuredOutcomeJson,
  tryParseStructuredOutcomeFromAssistantProse,
  validateStructuredOutcome,
} from '../../src/agents/sub-agent-structured-outcome.ts';

const VALID_OUTCOME_JSON = `{
  "summary": "Explored auth module.",
  "findings": [
    {
      "title": "Missing guard",
      "detail": "Route /api/foo has no auth middleware.",
      "severity": "blocker",
      "paths": ["src/api/foo.ts"]
    }
  ],
  "artifacts": [
    { "kind": "path", "label": "Report", "ref": "docs/notes.md" }
  ]
}`;

describe('sub-agent structured outcome', () => {
  test('extractJsonTextFromAssistantBody reads fenced JSON', () => {
    const body = 'Here is the result:\n```json\n{"summary":"ok","findings":[],"artifacts":[]}\n```';
    const text = extractJsonTextFromAssistantBody(body);
    assert.equal(text, '{"summary":"ok","findings":[],"artifacts":[]}');
  });

  test('validateStructuredOutcome accepts v1 preset', () => {
    const parsed = parseStructuredOutcomeJson(VALID_OUTCOME_JSON);
    const outcome = validateStructuredOutcome(parsed, 'minnow.sub-agent.v1');
    assert.ok(outcome);
    assert.equal(outcome.summary, 'Explored auth module.');
    assert.equal(outcome.findings.length, 1);
    assert.equal(outcome.findings[0].severity, 'blocker');
    assert.equal(outcome.artifacts[0].kind, 'path');
  });

  test('lite preset rejects non-empty findings', () => {
    const parsed = parseStructuredOutcomeJson(VALID_OUTCOME_JSON);
    const outcome = validateStructuredOutcome(parsed, 'minnow.sub-agent.lite');
    assert.equal(outcome, null);
  });

  test('invalid JSON returns null on validate after parse failure', () => {
    assert.throws(() => parseStructuredOutcomeJson('not json'));
  });

  test('tryParseStructuredOutcomeFromAssistantProse accepts work-turn JSON', () => {
    const outcome = tryParseStructuredOutcomeFromAssistantProse(
      VALID_OUTCOME_JSON,
      'minnow.sub-agent.v1',
    );
    assert.ok(outcome);
    assert.equal(outcome.summary, 'Explored auth module.');
  });

  test('tryParseStructuredOutcomeFromAssistantProse rejects plain prose', () => {
    assert.equal(
      tryParseStructuredOutcomeFromAssistantProse('All done, no JSON here.', 'minnow.sub-agent.v1'),
      null,
    );
  });
});
