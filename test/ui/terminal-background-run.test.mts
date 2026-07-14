/**
 * Background shell tool payload parsing for agent terminal bridge (MIN-402).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  parseBackgroundShellToolPayload,
  extractShellRunIdFromToolResult,
} from '../../src/ui/tool-messages.ts';

const RUN_ID = '11111111-1111-1111-1111-111111111111';
const STARTED_AT = 1710000000000;

describe('terminal background run payload', () => {
  test('parseBackgroundShellToolPayload reads execute_command background fields', () => {
    const result = JSON.stringify({
      ok: true,
      background: true,
      runId: RUN_ID,
      startedAt: STARTED_AT,
      output: 'ready\n',
    });
    const payload = parseBackgroundShellToolPayload('execute_command', result);
    assert.deepEqual(payload, {
      runId: RUN_ID,
      startedAt: STARTED_AT,
      output: 'ready\n',
    });
    assert.equal(extractShellRunIdFromToolResult('execute_command', result), RUN_ID);
  });

  test('parseBackgroundShellToolPayload reads start_background_command fields', () => {
    const result = JSON.stringify({
      ok: true,
      runId: RUN_ID,
      startedAt: STARTED_AT,
    });
    const payload = parseBackgroundShellToolPayload('start_background_command', result);
    assert.deepEqual(payload, {
      runId: RUN_ID,
      startedAt: STARTED_AT,
    });
  });

  test('parseBackgroundShellToolPayload rejects blocking execute_command', () => {
    const result = JSON.stringify({
      ok: true,
      runId: RUN_ID,
    });
    assert.equal(parseBackgroundShellToolPayload('execute_command', result), null);
  });

  test('parseBackgroundShellToolPayload rejects tool errors', () => {
    assert.equal(
      parseBackgroundShellToolPayload('execute_command', 'Error: spawn failed'),
      null,
    );
  });
});
