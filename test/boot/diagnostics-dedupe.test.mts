import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildSurfaceKey,
  firstStackFrame,
  resetDiagnosticsSurfaceStateForTests,
  shouldSurface,
} from '../../src/boot/diagnostics.ts';

describe('renderer diagnostics dedupe', () => {
  test('firstStackFrame extracts first at-line', () => {
    const stack = 'Error: boom\n    at foo (file.ts:1:1)\n    at bar (file.ts:2:2)';
    assert.equal(firstStackFrame(stack), 'at foo (file.ts:1:1)');
  });

  test('shouldSurface suppresses duplicate UI within 10s but always logs', () => {
    resetDiagnosticsSurfaceStateForTests();
    const key = buildSurfaceKey('kind', 'msg', 'at x');
    const t0 = 1_000_000;
    const first = shouldSurface(key, t0);
    assert.equal(first.logToMain, true);
    assert.equal(first.surfaceUi, true);

    const second = shouldSurface(key, t0 + 5_000);
    assert.equal(second.logToMain, true);
    assert.equal(second.surfaceUi, false);
  });

  test('shouldSurface rolls suppression card after global cap', () => {
    resetDiagnosticsSurfaceStateForTests();
    const t0 = 2_000_000;
    for (let i = 0; i < 5; i += 1) {
      const d = shouldSurface(`key-${i}`, t0 + i);
      assert.equal(d.surfaceUi, true);
    }
    const overflow = shouldSurface('key-overflow', t0 + 10);
    assert.equal(overflow.surfaceUi, false);
    assert.equal(overflow.rollSuppressionCard, true);
  });
});
