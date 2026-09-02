import { iconHtml } from '../icon';

const EMAIL_KEYS = [
  'compose',
  'reply',
  'replyAll',
  'forward',
  'star',
  'starFilled',
  'archive',
  'trash',
  'mail',
  'mailOpen',
  'attach',
  'sync',
  'search',
  'more',
  'chevronLeft',
  'chevronRight',
  'back',
  'folder',
  'spam',
  'snooze',
  'move',
  'help',
  'dashboard',
  'automations',
  'testConnection',
  'settings',
  'signOut',
  'close',
] as const;

type EmailIconKey = (typeof EMAIL_KEYS)[number];

function emailIconMarkup(key: EmailIconKey): string {
  const extra =
    key === 'starFilled'
      ? 'email-icon email-icon--filled'
      : 'email-icon';
  return iconHtml(key, { className: extra });
}

/** Icon markup keyed by mail action affordance. */
export const EMAIL_ICONS = Object.fromEntries(
  EMAIL_KEYS.map((key) => [key, emailIconMarkup(key)]),
) as Record<EmailIconKey, string>;
