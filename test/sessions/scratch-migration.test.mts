import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  CHAT_APP_ID,
  CODE_APP_ID,
} from '../../src/state/session-workspace-scope.ts';
import {
  createEmptyChatObject,
  migrateScratchWorkspacePaths,
} from '../../src/state/sessions.ts';
import { defaultSessionState } from '../../src/config/defaults.ts';

const SCRATCH = '/home/user/.minnow/workspace';
const LEGACY_CHATS = '/home/user/.minnow/chats';

describe('migrateScratchWorkspacePaths', () => {
  test('rewrites legacy sandbox and empty workspace paths to Scratch', () => {
    const state = defaultSessionState();
    state.chats = [
      createEmptyChatObject('m1', ''),
      createEmptyChatObject('m2', LEGACY_CHATS),
      createEmptyChatObject('m3', '/home/user/project'),
    ];
    state.chats[0].modeId = 'desktop';
    state.lastActiveChatIdByWorkspace = {
      '': state.chats[0].id,
      [LEGACY_CHATS]: state.chats[1].id,
    };
    state.lastActiveChatIdByApp = { [CHAT_APP_ID]: state.chats[1].id };

    migrateScratchWorkspacePaths(state, SCRATCH);

    assert.equal(state.chats[0].workspacePath, SCRATCH);
    assert.equal(state.chats[0].modeId, 'general');
    assert.equal(state.chats[1].workspacePath, SCRATCH);
    assert.equal(state.chats[2].workspacePath, '/home/user/project');
    assert.equal(state.lastActiveChatIdByWorkspace[SCRATCH], state.chats[1].id);
    assert.equal(state.lastActiveChatIdByApp[CODE_APP_ID], state.chats[1].id);
    assert.equal(state.lastActiveChatIdByApp[CHAT_APP_ID], undefined);
  });
});
