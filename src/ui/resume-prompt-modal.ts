import { appConfirm } from './app-dialog';

/** One line in the prompt: what would restart, and why it is pending. */
export interface ResumePromptItem {
  label: string;
  detail: string;
}

export type ResumePromptChoice = 'resume' | 'decline';

let inFlight: Promise<ResumePromptChoice> | null = null;

function buildItemList(items: readonly ResumePromptItem[]): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'app-dialog-list';
  for (const item of items) {
    const row = document.createElement('li');
    row.className = 'app-dialog-list__item';

    const label = document.createElement('span');
    label.className = 'app-dialog-list__label';
    label.textContent = item.label;
    row.appendChild(label);

    const detail = document.createElement('span');
    detail.className = 'app-dialog-list__detail';
    detail.textContent = item.detail;
    row.appendChild(detail);

    list.appendChild(row);
  }
  return list;
}

/** Ask whether to restart the listed work. */
export function showResumePromptModal(
  items: readonly ResumePromptItem[],
): Promise<ResumePromptChoice> {
  if (inFlight) return inFlight;
  if (!items.length) return Promise.resolve('decline');

  const noun = items.length === 1 ? 'this' : 'these';
  inFlight = appConfirm(
    `Minnow closed while work was in progress. Restart ${noun}?`,
    {
      title: 'Resume interrupted work?',
      confirmLabel: 'Resume',
      cancelLabel: "Don't resume",
      body: buildItemList(items),
    },
  )
    .then((confirmed): ResumePromptChoice => (confirmed ? 'resume' : 'decline'))
    .catch((): ResumePromptChoice => 'decline')
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
