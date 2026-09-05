/**
 * Copy and IPC payload for the multi-window close prompt.
 *
 * Kept free of Electron imports so tests can assert the wording without a
 * BrowserWindow. Main sends this to the renderer; the native MessageBox is
 * only a fallback when the SPA is not ready yet.
 */

export type WindowClosePromptAction = 'close' | 'background' | 'cancel';

export interface WindowClosePromptCopy {
  title: string;
  heading: string;
  folder: string;
  detail: string;
  checkboxLabel: string;
}

export interface WindowClosePromptPayload extends WindowClosePromptCopy {
  requestId: string;
}

export interface WindowClosePromptReply {
  action: WindowClosePromptAction;
  remember: boolean;
}

const TITLE = 'Close workspace?';
const CHECKBOX_LABEL = 'Do this every time';

const DETAIL_WITH_FOLDER =
  'Keeping it in the background leaves its chats and agents running and reachable from the tray. Closing it stops them and drops the folder from the next launch.';

const DETAIL_WITHOUT_FOLDER =
  'Keeping it in the background leaves it running and reachable from the tray.';

/** Labels and body text for one close prompt. */
export function buildWindowClosePromptCopy(
  folder: string,
  name: string,
): WindowClosePromptCopy {
  const trimmed = folder.trim();
  return {
    title: TITLE,
    heading: `Close ${name}?`,
    folder: trimmed,
    detail: trimmed ? DETAIL_WITH_FOLDER : DETAIL_WITHOUT_FOLDER,
    checkboxLabel: CHECKBOX_LABEL,
  };
}

/** Native MessageBox `detail` field: path (when known) then the explanation. */
export function formatNativeWindowCloseDetail(copy: WindowClosePromptCopy): string {
  if (!copy.folder) return copy.detail;
  return `${copy.folder}\n\n${copy.detail}`;
}

/** Coerce a renderer IPC reply. Unknown payloads cancel and never remember. */
export function parseWindowClosePromptReply(raw: unknown): WindowClosePromptReply {
  if (!raw || typeof raw !== 'object') {
    return { action: 'cancel', remember: false };
  }
  const record = raw as Record<string, unknown>;
  const action: WindowClosePromptAction =
    record.action === 'close' || record.action === 'background' ? record.action : 'cancel';
  const remember = record.remember === true && action !== 'cancel';
  return { action, remember };
}

/** Same as `parseWindowClosePromptReply`, plus the request id from IPC. */
export function parseWindowClosePromptIpc(raw: unknown): WindowClosePromptReply & {
  requestId: string;
} {
  const reply = parseWindowClosePromptReply(raw);
  const requestId =
    raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).requestId === 'string'
      ? ((raw as Record<string, unknown>).requestId as string)
      : '';
  return { requestId, ...reply };
}
