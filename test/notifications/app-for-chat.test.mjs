import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('appIdForChat', () => {
  test('returns chat for ~/.minnow/chats workspace paths', async () => {
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
      'chat',
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
