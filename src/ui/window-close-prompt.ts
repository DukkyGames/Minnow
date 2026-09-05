/**
 * In-app close-workspace prompt. Main sends copy over IPC; this file only
 * renders it with the shared app dialog.
 */

import type { MinnowWindowClosePrompt, MinnowWindowClosePromptReply } from '../electron.d';
import { appChoice } from './app-dialog';

let initDone = false;

function buildPromptBody(folder: string, detail: string): HTMLElement {
  const body = document.createElement('div');
  if (folder) {
    const pathEl = document.createElement('p');
    pathEl.className = 'app-dialog-panel__path';
    pathEl.textContent = folder;
    body.appendChild(pathEl);
  }
  const detailEl = document.createElement('p');
  detailEl.className = 'app-dialog-panel__detail';
  detailEl.textContent = detail;
  body.appendChild(detailEl);
  return body;
}

/** Show the three-way close prompt and return the user's answer. */
export async function showWindowClosePrompt(
  payload: MinnowWindowClosePrompt,
): Promise<MinnowWindowClosePromptReply> {
  const result = await appChoice({
    title: payload.title,
    message: payload.heading,
    body: buildPromptBody(payload.folder, payload.detail),
    checkboxLabel: payload.checkboxLabel,
    checkboxChecked: false,
    cancelId: 'cancel',
    defaultFocusId: 'background',
    buttons: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'close', label: 'Close workspace', danger: true },
      { id: 'background', label: 'Keep in background', primary: true },
    ],
  });

  const action =
    result.id === 'close' || result.id === 'background' ? result.id : 'cancel';
  return {
    action,
    remember: result.checkboxChecked && action !== 'cancel',
  };
}

/** Listen for main-process close prompts once the tray preload is present. */
export function initWindowClosePromptBridge(): void {
  if (initDone) return;
  const api = window.minnow?.tray;
  if (!api?.onWindowClosePrompt || !api.replyWindowClosePrompt) return;
  initDone = true;

  api.onWindowClosePrompt((payload) => {
    void showWindowClosePrompt(payload).then((reply) => {
      api.replyWindowClosePrompt?.(payload.requestId, reply);
    });
  });
}
