/**
 * models.dev is the authoritative catalog for opencode.ai models — including the
 * negative case, which is what stops a text-only GLM from being sold as a VLM.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { modelsDevVisionFlag } from '../../server/providers/models-dev-context.js';

describe('modelsDevVisionFlag', () => {
  it('reads image input from modalities', () => {
    assert.equal(
      modelsDevVisionFlag({ modalities: { input: ['text', 'image'], output: ['text'] } }),
      true,
    );
  });

  it('reads a text-only model as an explicit no', () => {
    // GLM ships `attachment: false` and `input: ["text"]`; before this the row
    // said nothing and the probe's HTTP 200 was mistaken for vision.
    assert.equal(
      modelsDevVisionFlag({ attachment: false, modalities: { input: ['text'] } }),
      false,
    );
  });

  it('falls back to the older attachment flag as a positive only', () => {
    assert.equal(modelsDevVisionFlag({ attachment: true }), true);
    assert.equal(modelsDevVisionFlag({ attachment: false }), undefined);
  });

  it('has no opinion about a missing entry', () => {
    assert.equal(modelsDevVisionFlag(undefined), undefined);
    assert.equal(modelsDevVisionFlag({}), undefined);
    assert.equal(modelsDevVisionFlag({ modalities: { input: [] } }), undefined);
  });
});
