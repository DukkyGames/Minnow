/**
 * Kitchen-sink session shape contract: server validateSessionState and client
 * parseSessionStateFromJson must agree (migration JSON→SQLite Phase A.0).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateSessionState } from '../../server/config/validators.js';
import { parseSessionStateFromJson } from '../../src/state/sessions.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(
  __dirname,
  '../fixtures/migration/kitchen-sink-sessions-state.json',
);

/** Drop undefined keys so client object literals match server omit-style shapes. */
function canonicalize(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('session shape parity (kitchen-sink)', () => {
  test('server validateSessionState and client parseSessionStateFromJson deep-equal', () => {
    const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

    const serverState = canonicalize(validateSessionState(structuredClone(raw)));
    const clientState = canonicalize(parseSessionStateFromJson(structuredClone(raw)));

    assert.deepEqual(serverState, clientState);
  });

  test('previously dropped Chat fields survive server validateSessionState', () => {
    const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const out = validateSessionState(structuredClone(raw));
    const chat = out.chats[0];

    const keys = [
      'subAgentRuns',
      'todos',
      'todosUpdatedAt',
      'tokenLedger',
      'codeChangeTotals',
      'codeChangeBackfillAt',
      'lastContextTrim',
      'composerDraft',
      'pinnedSkill',
      'thinkingMode',
      'reasoningEffort',
      'uiDesignerMode',
      'pendingSteerMessage',
      'pendingMessageQueue',
      'pendingModeId',
      'turnError',
    ];
    for (const key of keys) {
      assert.notEqual(chat[key], undefined, `expected chat.${key} to survive`);
    }
    assert.ok(out.codeChangeTotalsByWorkspace);
    assert.equal(out.codeChangeTotalsByWorkspace['C:/demo/KitchenSink'].additions, 12);
  });
});
