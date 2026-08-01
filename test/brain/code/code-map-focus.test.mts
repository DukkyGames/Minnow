/**
 * Code-map focus hint extraction for injection PageRank bias.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractCodeMapFocusHints } from '../../../src/brain/code-map-focus.ts';

describe('extractCodeMapFocusHints', () => {
  it('collects attachment paths and path-like tokens from the message', () => {
    const hints = extractCodeMapFocusHints(
      'Fix bug in server/simulation/tick.ts — executeDay churn',
      ['src/components/Dashboard.tsx'],
    );
    assert.deepEqual(hints.focusFiles, [
      'src/components/Dashboard.tsx',
      'server/simulation/tick.ts',
    ]);
    assert.equal(hints.focus, undefined);
  });

  it('uses a single path stem as focus when only one file is hinted', () => {
    const hints = extractCodeMapFocusHints('bug in server/simulation/tick.ts', []);
    assert.deepEqual(hints.focusFiles, ['server/simulation/tick.ts']);
    assert.equal(hints.focus, 'tick');
  });

  it('does not use the full user message as focus when ambiguous', () => {
    const hints = extractCodeMapFocusHints(
      'Please review the simulation and orchestrator wiring',
      [],
    );
    assert.equal(hints.focusFiles.length, 0);
    assert.equal(hints.focus, undefined);
  });
});
