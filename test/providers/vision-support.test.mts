/**
 * Three-state vision resolution: what Minnow knows, what it guesses, and what it
 * refuses to guess. `unknown` must stay send-able — that is the whole point.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  canSendImagesToModel,
  clearRecordedImageRejections,
  isImageRejectionError,
  isVisionModel,
  recordImageRejection,
  resolveVisionSupport,
} from '../../src/providers/vision-model.ts';
import type { LmModelRecord } from '../../src/types.ts';

const catalog = (rows: LmModelRecord[]): LmModelRecord[] => rows;

describe('resolveVisionSupport', () => {
  beforeEach(() => {
    clearRecordedImageRejections();
  });

  it('reads a catalog vlm row as yes', () => {
    const rows = catalog([{ id: 'qwen-omni', type: 'vlm' }]);
    assert.equal(resolveVisionSupport('qwen-omni', rows), 'yes');
    assert.equal(isVisionModel('qwen-omni', rows), true);
  });

  it('reads an explicit catalogVision:false as no', () => {
    const rows = catalog([{ id: 'glm-5.2', type: 'llm', catalogVision: false }]);
    assert.equal(resolveVisionSupport('glm-5.2', rows), 'no');
    assert.equal(canSendImagesToModel('glm-5.2', rows), false);
  });

  it('reads a probe-sourced vision:false as no', () => {
    const rows = catalog([
      {
        id: 'text-only',
        type: 'llm',
        capabilities: { vision: false, sources: { vision: 'probe' } },
      } as LmModelRecord,
    ]);
    assert.equal(resolveVisionSupport('text-only', rows), 'no');
  });

  it('leaves a bare llama.cpp row unknown rather than guessing no', () => {
    const rows = catalog([{ id: 'gemma-3-12b-it', type: 'llm' }]);
    assert.equal(resolveVisionSupport('gemma-3-12b-it', rows), 'unknown');
    // The badge stays honest…
    assert.equal(isVisionModel('gemma-3-12b-it', rows), false);
    // …but an attached screenshot is still sent rather than silently dropped.
    assert.equal(canSendImagesToModel('gemma-3-12b-it', rows), true);
  });

  it('still promotes an obvious VLM id to yes', () => {
    const rows = catalog([{ id: 'Qwen3-VL-8B', type: 'llm' }]);
    assert.equal(resolveVisionSupport('Qwen3-VL-8B', rows), 'yes');
  });

  it('treats a live rejection as authoritative for the rest of the session', () => {
    const rows = catalog([{ id: 'gemma-3-12b-it', type: 'llm' }]);
    assert.equal(canSendImagesToModel('gemma-3-12b-it', rows), true);
    recordImageRejection('gemma-3-12b-it');
    assert.equal(resolveVisionSupport('gemma-3-12b-it', rows), 'no');
    assert.equal(canSendImagesToModel('gemma-3-12b-it', rows), false);
  });

  it('has no opinion without a model id', () => {
    assert.equal(resolveVisionSupport(undefined), 'no');
    assert.equal(canSendImagesToModel(undefined), false);
  });
});

describe('isImageRejectionError', () => {
  it('matches image-shaped 400s', () => {
    assert.equal(
      isImageRejectionError(new Error('HTTP 400: model does not support image input')),
      true,
    );
    assert.equal(
      isImageRejectionError(new Error('400 Bad Request: invalid image_url part')),
      true,
    );
    assert.equal(
      isImageRejectionError(new Error('HTTP 500: no multimodal support (mmproj missing)')),
      true,
    );
  });

  it('ignores unrelated failures', () => {
    assert.equal(isImageRejectionError(new Error('HTTP 429: rate limited')), false);
    assert.equal(isImageRejectionError(new Error('HTTP 401: bad api key')), false);
    // Status-gated: an image mentioned in a non-4xx body must not strip pixels.
    assert.equal(isImageRejectionError(new Error('generated an image successfully')), false);
  });
});
