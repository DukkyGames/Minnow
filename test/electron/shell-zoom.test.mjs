import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clampShellZoomPercent,
  shellZoomFactorFromPercent,
  shellZoomPercentFromFactor,
} from '../../electron/shell-zoom.ts';

describe('shell zoom helpers', () => {
  test('clampShellZoomPercent defaults invalid input to 80', () => {
    assert.equal(clampShellZoomPercent(undefined), 80);
    assert.equal(clampShellZoomPercent('80'), 80);
  });

  test('clampShellZoomPercent enforces 50–300', () => {
    assert.equal(clampShellZoomPercent(40), 50);
    assert.equal(clampShellZoomPercent(400), 300);
    assert.equal(clampShellZoomPercent(67), 67);
  });

  test('factor and percent round-trip', () => {
    assert.equal(shellZoomFactorFromPercent(80), 0.8);
    assert.equal(shellZoomPercentFromFactor(0.8), 80);
  });
});
