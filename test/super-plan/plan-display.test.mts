/**
 * Super Plan display titles for library and run header.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createSuperPlanState, createInitialSuperPlanStages } from '../../src/chat/super-plan/state.ts';
import { resolveSuperPlanDisplayTitle } from '../../src/chat/super-plan/plan-library.ts';

describe('resolveSuperPlanDisplayTitle', () => {
  test('prefers displayTitle over prompt', () => {
    const sp = createSuperPlanState('A very long prompt that should not appear as the title');
    sp.displayTitle = 'OAuth Login';
    assert.equal(resolveSuperPlanDisplayTitle(sp), 'OAuth Login');
  });

  test('derives title from plan path when present', () => {
    const sp = createSuperPlanState('prompt');
    sp.stages = createInitialSuperPlanStages();
    sp.planPath = 'documentation/plans/oauth-login-flow.md';
    assert.equal(
      resolveSuperPlanDisplayTitle(sp, sp.planPath),
      'Oauth login flow',
    );
  });
});
