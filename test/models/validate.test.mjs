import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  validateGgufFilename,
  validateJobId,
  validateRepoId,
  validateRuntime,
} from '../../server/models/validate.js';

describe('models validate', () => {
  test('validateRepoId accepts org/name', () => {
    assert.equal(validateRepoId('unsloth/Olmo-3-7B-Instruct-GGUF'), 'unsloth/Olmo-3-7B-Instruct-GGUF');
  });

  test('validateRepoId rejects shell metacharacters', () => {
    assert.throws(() => validateRepoId('bad;rm'), /Invalid repoId/);
  });

  test('validateGgufFilename accepts .gguf', () => {
    assert.equal(validateGgufFilename('model-Q4_K_M.gguf'), 'model-Q4_K_M.gguf');
  });

  test('validateRuntime accepts llama-cpp', () => {
    assert.equal(validateRuntime('llama-cpp'), 'llama-cpp');
  });

  test('validateJobId accepts uuid', () => {
    assert.equal(
      validateJobId('11111111-1111-4111-8111-111111111111'),
      '11111111-1111-4111-8111-111111111111',
    );
  });
});
