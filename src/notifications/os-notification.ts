/**
 * Native OS notifications for alerts you must not miss.
 *
 * Only fires when the Minnow window is **unfocused** — an in-app bell is enough
 * while you are looking at the app, and a duplicate desktop toast over a window
 * you are already using is noise.
 *
 * No new IPC: the renderer is a Chromium page, and Electron routes the Web
 * Notification API to the OS using the AppUserModelID that `electron/main.ts`
 * already sets to the frozen `build.appId` (`org.grimmedia.minnow`). Open
 * question 5 in the epic plan is closed by that: Windows notifications work
 * as-is and nothing about the packaged identity has to change.
 *
 * Phase 4 of `documentation/plans/issues-app-v2.md`.
 */

export interface OsNotificationInput {
  title: string;
  body: string;
  /** Dedupe + replace key; a second alert for the same issue supersedes. */
  tag?: string;
  /** Run when the user clicks the desktop notification. */
  onClick?: () => void;
}

type NotificationCtor = new (title: string, options?: NotificationOptions) => Notification;

function notificationApi(): NotificationCtor | null {
  const ctor = (globalThis as { Notification?: unknown }).Notification;
  return typeof ctor === 'function' ? (ctor as NotificationCtor) : null;
}

/** True when the app window is not the user's current focus. */
export function isWindowUnfocused(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.visibilityState === 'hidden') return true;
  return typeof document.hasFocus === 'function' ? !document.hasFocus() : false;
}

/**
 * Show a desktop notification, or do nothing.
 *
 * Returns whether one was shown, so callers can log or test the decision
 * without reaching into the platform API.
 */
export function notifyOs(input: OsNotificationInput): boolean {
  const Ctor = notificationApi();
  if (!Ctor) return false;
  if (!isWindowUnfocused()) return false;

  const permission = (Ctor as unknown as { permission?: string }).permission;
  if (permission === 'denied' || permission === 'default') return false;

  try {
    const notification = new Ctor(input.title, {
      body: input.body,
      tag: input.tag,
      silent: true,
    });
    notification.onclick = () => {
      try {
        window.focus();
        input.onClick?.();
      } finally {
        notification.close();
      }
    };
    return true;
  } catch {
    return false;
  }
}
