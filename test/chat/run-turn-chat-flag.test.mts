/**
 * P6-D: the dual-path flag is deleted. All chat sends go through `runTurn`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('P6-D dual-path flag removed (MIN-726)', () => {
  test('run-turn-chat-flag.ts does not exist', () => {
    const flagPath = path.join(PROJECT_ROOT, 'src', 'chat', 'run-turn-chat-flag.ts');
    assert.equal(fs.existsSync(flagPath), false);
  });

  test('src/tools/loop.ts does not exist', () => {
    const loopPath = path.join(PROJECT_ROOT, 'src', 'tools', 'loop.ts');
    assert.equal(fs.existsSync(loopPath), false);
  });

  test('adapter source has no localStorage dual-path keys', () => {
    const src = fs.readFileSync(
      path.join(PROJECT_ROOT, 'src', 'chat', 'run-turn-chat.ts'),
      'utf8',
    );
    assert.equal(src.includes('minnow.p6c.runTurnChat'), false);
    assert.equal(src.includes('minnow.p6a.runTurnChat'), false);
    assert.equal(src.includes('isRunTurnChatEnabled'), false);
  });
});
