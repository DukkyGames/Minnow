/**
 * mlx-lm ServeActivity synthesis — no /slots, no fake queue chip.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { serveActivityChipLabels } from '../../src/models/serve-activity-chips.ts';
import { buildMlxServeActivity } from '../../src/models/mlx-serve-activity.ts';

const SERVE = {
  id: 'serve-mlx',
  runtime: 'mlx-lm',
  modelLabel: '/tmp/snapshot',
  libraryId: 'lib-mlx',
};

describe('mlx serve activity', () => {
  test('idle mlx serve is Ready with no queued chip', () => {
    const activity = buildMlxServeActivity(SERVE, null);
    assert.ok(activity);
    assert.equal(activity.queued, 0);
    assert.deepEqual(serveActivityChipLabels(activity), ['Ready']);
  });

  test('keepalive overlay becomes a prefill percent chip', () => {
    const overlay = {
      serveId: null,
      libraryId: 'lib-mlx',
      modelLabel: 'lib-mlx',
      processed: 1024,
      total: 4096,
      cache: 0,
      predictedN: 0,
    };
    const activity = buildMlxServeActivity(SERVE, overlay);
    assert.deepEqual(serveActivityChipLabels(activity, overlay), ['0 PP 25%']);
  });

  test('synthesized gen count becomes a GEN chip', () => {
    const overlay = {
      serveId: null,
      libraryId: 'lib-mlx',
      modelLabel: 'lib-mlx',
      processed: 4096,
      total: 4096,
      cache: 0,
      predictedN: 42,
    };
    const activity = buildMlxServeActivity(SERVE, overlay);
    assert.deepEqual(serveActivityChipLabels(activity, overlay), ['0 GEN 42 tok']);
  });

  test('overlay for another model leaves the host Ready', () => {
    const overlay = {
      serveId: 'other',
      libraryId: 'lib-other',
      modelLabel: 'other',
      processed: 10,
      total: 100,
      cache: 0,
      predictedN: 0,
    };
    const activity = buildMlxServeActivity(SERVE, overlay);
    assert.deepEqual(serveActivityChipLabels(activity, overlay), ['Ready']);
  });

  test('llama.cpp serves are not synthesized', () => {
    assert.equal(
      buildMlxServeActivity({ ...SERVE, runtime: 'llama-cpp' }, null),
      null,
    );
  });
});
