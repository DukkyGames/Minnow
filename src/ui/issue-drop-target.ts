import {
  filesFromDataTransfer,
  hasExternalFileDrag,
  isLikelyDirectoryDrop,
} from '../attachments/external-file-drop';
import { partitionParentDrop } from '../issues/hierarchy';
import { getActiveIssueDragIds, readIssueDragIds } from '../issues/issue-drag';
import { listIssues } from '../state/issues-store';
import {
  capturePayloadFromDataTransfer,
  dataTransferLooksCapturable,
} from './capture-drag';
import { attachCaptureToIssue } from './issue-capture';
import { ingestIssueFiles } from './issues-attachments-section';

export type IssueDropChanged = () => void;

/** True when a drag may be dropped onto an issue target as capture or files. */
export function dataTransferAcceptsIssueDrop(dataTransfer: DataTransfer | null): boolean {
  return dataTransferLooksCapturable(dataTransfer) || hasExternalFileDrag(dataTransfer);
}

/** Ids that would nest under `issueId` from this drag. */
export function acceptedParentDropIds(
  issueId: string,
  dataTransfer?: DataTransfer | null,
): string[] {
  const ids = readIssueDragIds(dataTransfer ?? null);
  if (ids.length === 0) return [];
  return partitionParentDrop(issueId, ids, listIssues()).accepted;
}

function markParentDropAllowed(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

/** Wire dragover/drop on a list row, board card, or detail panel. */
export function bindIssueDropTarget(
  el: HTMLElement,
  issueId: string,
  onChanged?: IssueDropChanged,
): void {
  const notify = onChanged ?? (() => {});

  // Capture so chips/buttons inside a list row cannot swallow dragover/drop.
  const onDragOver = (event: DragEvent): void => {
    const parentIds = acceptedParentDropIds(issueId, event.dataTransfer);
    if (getActiveIssueDragIds().length > 0 || parentIds.length > 0) {
      el.classList.remove('is-capture-target');
      if (parentIds.length === 0) {
        el.classList.remove('is-parent-target');
        event.stopPropagation();
        return;
      }
      markParentDropAllowed(event);
      el.classList.add('is-parent-target');
      return;
    }

    if (!dataTransferAcceptsIssueDrop(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = hasExternalFileDrag(event.dataTransfer) ? 'copy' : 'link';
    }
    el.classList.add('is-capture-target');
  };

  el.addEventListener('dragenter', onDragOver, true);
  el.addEventListener('dragover', onDragOver, true);

  el.addEventListener('dragleave', (event) => {
    const related = event.relatedTarget;
    if (related instanceof Node && el.contains(related)) return;
    el.classList.remove('is-capture-target');
    el.classList.remove('is-parent-target');
  });

  el.addEventListener(
    'drop',
    (event) => {
    el.classList.remove('is-capture-target');
    el.classList.remove('is-parent-target');

    const dragIds = readIssueDragIds(event.dataTransfer);
    if (dragIds.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      if (acceptedParentDropIds(issueId, event.dataTransfer).length === 0) return;
      void import('./issues-sub-issues').then((m) => {
        m.applyIssueParentDrop(issueId, dragIds);
        notify();
      });
      return;
    }

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
    },
    true,
  );
}
