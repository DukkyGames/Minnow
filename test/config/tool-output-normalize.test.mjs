/**
 * tools.json toolOutput normalize + clamp (MIN-667).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeToolConfig } from '../../server/config/validators.js';
import {
  DEFAULT_MAX_OUTPUT_CHARS,
  TOOL_OUTPUT_MAX_CHARS_MAX,
  TOOL_OUTPUT_MAX_CHARS_MIN,
} from '../../server/tools/output-cap.js';

describe('normalizeToolConfig toolOutput', () => {
  it('defaults to truncation on at the raised character budget', () => {
    const config = normalizeToolConfig({});
    assert.equal(config.toolOutput.enabled, true);
    assert.equal(config.toolOutput.maxChars, DEFAULT_MAX_OUTPUT_CHARS);
  });

  it('clamps maxChars into the allowed range', () => {
    const low = normalizeToolConfig({ toolOutput: { enabled: true, maxChars: 12 } });
    assert.equal(low.toolOutput.maxChars, TOOL_OUTPUT_MAX_CHARS_MIN);

    const high = normalizeToolConfig({
      toolOutput: { enabled: false, maxChars: 99_000_000 },
    });
    assert.equal(high.toolOutput.enabled, false);
    assert.equal(high.toolOutput.maxChars, TOOL_OUTPUT_MAX_CHARS_MAX);
  });
});
