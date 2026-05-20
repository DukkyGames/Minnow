/**
 * Default provider paths include v1 load/unload for LM Studio.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultPaths, getProviderCapabilities } from '../../server/providers/paths.js';

describe('provider paths', () => {
  it('lm-studio-v0 includes v1 load and unload paths', () => {
    const paths = getDefaultPaths('lm-studio-v0');
    assert.equal(paths.modelsPath, '/api/v0/models');
    assert.equal(paths.chatCompletionsPath, '/api/v0/chat/completions');
    assert.equal(paths.modelsLoadPath, '/api/v1/models/load');
    assert.equal(paths.modelsUnloadPath, '/api/v1/models/unload');
  });

  it('openai-v1 has no load/unload paths', () => {
    const paths = getDefaultPaths('openai-v1');
    assert.equal(paths.modelsPath, '/v1/models');
    assert.equal(paths.modelsLoadPath, undefined);
    assert.equal(paths.modelsUnloadPath, undefined);
  });

  it('getProviderCapabilities marks lm-studio-v0 as load-capable', () => {
    assert.equal(getProviderCapabilities('lm-studio-v0').supportsModelLoadUnload, true);
    assert.equal(getProviderCapabilities('openai-v1').supportsModelLoadUnload, false);
  });
});
