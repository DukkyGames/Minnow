/**
 * MLX config.json → context window tokens.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { contextLengthFromTransformersConfig } from '../../server/models/mlx-context-length.js';

describe('contextLengthFromTransformersConfig', () => {
  test('reads max_position_embeddings', () => {
    assert.equal(
      contextLengthFromTransformersConfig({ max_position_embeddings: 32_768 }),
      32_768,
    );
  });

  test('reads nested text_config', () => {
    assert.equal(
      contextLengthFromTransformersConfig({
        text_config: { max_position_embeddings: 128_000 },
      }),
      128_000,
    );
  });

  test('applies rope_scaling factor when present', () => {
    assert.equal(
      contextLengthFromTransformersConfig({
        max_position_embeddings: 8192,
        rope_scaling: { factor: 4, original_max_position_embeddings: 8192 },
      }),
      32_768,
    );
  });

  test('returns undefined for empty config', () => {
    assert.equal(contextLengthFromTransformersConfig({}), undefined);
    assert.equal(contextLengthFromTransformersConfig(null), undefined);
  });
});
