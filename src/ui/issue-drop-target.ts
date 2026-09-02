import {
  filesFromDataTransfer,
  hasExternalFileDrag,
  isLikelyDirectoryDrop,
} from '../attachments/external-file-drop';
import {
  capturePayloadFromDataTransfer,
  dataTransferLooksCapturable,
} from './capture-drag';
import { attachCaptureToIssue } from './issue-capture';
import { ingestIssueFiles } from './issues-attachments-section';

export type IssueDropChanged = () => void;

/** True when a drag may be dropped onto an issue target. */
export function dataTransferAcceptsIssueDrop(dataTransfer: DataTransfer | null): boolean {
  return dataTransferLooksCapturable(dataTransfer) || hasExternalFileDrag(dataTransfer);
}

/** Wire dragover/drop on a list row, board card, or detail panel. */
export function bindIssueDropTarget(
  el: HTMLElement,
  issueId: string,
  onChanged?: IssueDropChanged,
): void {
  const notify = onChanged ?? (() => {});

  el.addEventListener('dragover', (event) => {
    if (!dataTransferAcceptsIssueDrop(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = hasExternalFileDrag(event.dataTransfer) ? 'copy' : 'link';
    }
    el.classList.add('is-capture-target');
  });

  el.addEventListener('dragleave', (event) => {
    const related = event.relatedTarget;
    if (related instanceof Node && el.contains(related)) return;
    el.classList.remove('is-capture-target');
  });

  el.addEventListener('drop', (event) => {
    el.classList.remove('is-capture-target');
    if (!dataTransferAcceptsIssueDrop(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();

    if (hasExternalFileDrag(event.dataTransfer)) {
      const files = filesFromDataTransfer(event.dataTransfer!).filter(
        (file) => !isLikelyDirectoryDrop(file),
      );
      void ingestIssueFiles(issueId, files, notify);
      return;
    }

    const payload = capturePayloadFromDataTransfer(event.dataTransfer);
    if (!payload) return;
    void attachCaptureToIssue(issueId, payload).then((ok) => {
      if (ok) notify();
    });
  });
}
