/**
 * Open a notification target: foreground app + optional chat deep-link.
 */

import { launchApp } from '../os/router';
import { markNotificationRead } from './store';
import type { NotificationRecord } from './types';

/** Launch the owning app and switch to the linked chat when present. */
export async function openNotificationTarget(record: NotificationRecord): Promise<void> {
  markNotificationRead(record.id);

  if (record.chatId) {
    if (record.appId === 'chat') {
      const { launchChatWithThread } = await import('../os/chat-launch');
      await launchChatWithThread(record.chatId);
      return;
    }
    const { launchCodeWithChat } = await import('../os/chat-launch');
    await launchCodeWithChat(record.chatId);
    return;
  }

  if (record.kind === 'synthesis') {
    launchApp('settings', { settingsSection: 'memory' });
    return;
  }

  launchApp(record.appId);
}
