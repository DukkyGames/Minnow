import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('appIdForChat', () => {
  test('returns code for ~/.minnow/chats workspace paths', async () => {
    const { appIdForChat } = await import('../../src/notifications/app-for-chat.ts');
    assert.equal(
      appIdForChat({
        id: 'c1',
        name: 'Assistant',
        workspacePath: 'C:/Users/me/.minnow/chats',
        modelId: '',
        history: [],
        lastStats: null,
        modelInfo: {},
        updatedAt: 1,
      }),
      'code',
    );
  });

  test('returns code for former Email-scoped chats after the app was removed', async () => {
    const { appIdForChat } = await import('../../src/notifications/app-for-chat.ts');
    assert.equal(
      appIdForChat({
        id: 'email-chat-1',
        name: 'Inbox help',
        workspacePath: 'C:/Users/me/.minnow/chats',
        modelId: '',
        modeId: 'email',
        history: [],
        lastStats: null,
        modelInfo: {},
        updatedAt: 1,
      }),
      'code',
    );
  });

  test('returns code for project workspace chats', async () => {
    const { appIdForChat } = await import('../../src/notifications/app-for-chat.ts');
    assert.equal(
      appIdForChat({
        id: 'c2',
        name: 'Build',
        workspacePath: '/projects/my-app',
        modelId: '',
        history: [],
        lastStats: null,
        modelInfo: {},
        updatedAt: 1,
      }),
      'code',
    );
  });
});
