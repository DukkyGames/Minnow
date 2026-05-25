/**
 * Tool-result promotion rules (threshold + allowlist).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  maybePromoteToolResultToArtifact,
  DEFAULT_ARTIFACT_PROMOTION,
} from '../../../src/chat/reef/artifact-promotion.ts';

describe('artifact-promotion', () => {
  test('small output from non-allowlisted tool is no-op', async () => {
    const result = await maybePromoteToolResultToArtifact(
      {
        chatId: '00000000-0000-0000-0000-000000000099',
        chat: { id: '00000000-0000-0000-0000-000000000099', history: [] },
        toolName: 'calculate',
        args: {},
        content: '42',
        toolCallId: 'call-small-0001',
        modeId: 'reef',
      },
      DEFAULT_ARTIFACT_PROMOTION,
    );
    assert.equal(result, null);
  });
});
