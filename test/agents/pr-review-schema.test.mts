/**
 * minnow.pr-review.v1 accepts a well-formed outcome and rejects over-budget findings.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  SUB_AGENT_SUMMARY_SCHEMA_PRESETS,
  validateStructuredOutcomeForPreset,
} from '../../src/agents/sub-agent-summary-schemas.ts';

const preset = SUB_AGENT_SUMMARY_SCHEMA_PRESETS['minnow.pr-review.v1'];

describe('minnow.pr-review.v1', () => {
  test('is registered with a 40-finding cap', () => {
    assert.ok(preset);
    assert.equal(preset.maxFindings, 40);
    assert.equal(preset.maxArtifacts, 20);
    assert.equal(preset.maxSummaryChars, 2000);
    assert.equal(preset.maxDetailChars, 6000);
    assert.equal(preset.requireFindings, false);
  });

  test('accepts a well-formed outcome', () => {
    const outcome = validateStructuredOutcomeForPreset(
      {
        summary: 'REQUEST_CHANGES — 1 blocker, 0 warn, 0 info. The auth check is skipped.',
        findings: [
          {
            title: 'Missing authz on delete',
            detail: 'Gate delete_path on the session user. Suggested fix: return 403 when ids differ.',
            severity: 'blocker',
            paths: ['src/api/delete.ts'],
          },
        ],
        artifacts: [{ kind: 'path', label: 'delete handler', ref: 'src/api/delete.ts' }],
      },
      preset,
    );
    assert.ok(outcome);
    assert.equal(outcome.findings.length, 1);
    assert.equal(outcome.findings[0]?.severity, 'blocker');
  });

  test('rejects a 41st finding', () => {
    const findings = Array.from({ length: 41 }, (_, i) => ({
      title: `Finding ${i}`,
      detail: `Detail ${i}`,
      severity: 'info',
    }));
    const outcome = validateStructuredOutcomeForPreset(
      { summary: 'APPROVE — 0 blocker, 0 warn, 41 info.', findings, artifacts: [] },
      preset,
    );
    assert.equal(outcome, null);
  });

  test('drops an unknown severity rather than failing the outcome', () => {
    const outcome = validateStructuredOutcomeForPreset(
      {
        summary: 'NEEDS_DISCUSSION — 0 blocker, 1 warn, 0 info.',
        findings: [
          {
            title: 'Naming',
            detail: 'Rename foo to loadConfig. Suggested fix: search-replace.',
            severity: 'critical',
          },
        ],
        artifacts: [],
      },
      preset,
    );
    assert.ok(outcome);
    assert.equal(outcome.findings[0]?.severity, undefined);
  });
});
