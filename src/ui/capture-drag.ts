/**
 * Shell-wide drag layer for issue capture.
 *
 * Dragging anything linkable — a file-tree row, an editor selection, a capture
 * chip — should light up the Issues rail tile and the menubar capture button so
 * the drop target is obvious before the pointer gets there.
 *
 * The gotcha this is built around (documented in `file-tree-dnd.ts`): `dragover`
 * cannot call `DataTransfer.getData`, so highlighting can never key off the
 * payload. It keys off a module-level descriptor set on `dragstart` instead.
 * `dragover` only gets to ask "is a capture in flight", and the answer comes
 * from here, not from the event.
 *
 * Phase 2 of `documentation/plans/issues-app-v2.md`.
 */

import {
  CODE_SELECTION_MIME,
  parseCodeSelectionDragData,
} from '../attachments/code-selection-drag';
import { WORKSPACE_FILE_MIME } from '../attachments/workspace-ref';
import {
  ISSUE_CAPTURE_MIME,
  parseCaptureDragData,
  setCaptureDragData,
  type CapturePayload,
} from '../issues/capture-payload';
import { formatCodeRefLabel } from '../attachments/code-ref-format';

/** Active drag, or null. Read by drop targets during `dragover`. */
let activeDrag: CapturePayload | null = null;
let layerBound = false;

type Listener = (payload: CapturePayload | null) => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener(activeDrag);
    } catch {
      // A broken highlight must not break the drag.
    }
  }
}

/** Subscribe to drag start/end. Fires immediately with the current state. */
export function subscribeCaptureDrag(listener: Listener): () => void {
  listeners.add(listener);
  listener(activeDrag);
  return () => {
    listeners.delete(listener);
  };
}

/** The capture currently being dragged, or null. */
export function getActiveCaptureDrag(): CapturePayload | null {
  return activeDrag;
}

/** True while something droppable on an issue is in flight. */
export function isCaptureDragActive(): boolean {
  return activeDrag !== null;
}

/** Start a capture drag from a surface that built its own payload. */
export function beginCaptureDrag(
  dataTransfer: DataTransfer | null,
  payload: CapturePayload,
): void {
  if (dataTransfer) setCaptureDragData(dataTransfer, payload);
  activeDrag = payload;
  notify();
}

/** Clear the descriptor. Called on `dragend` and `drop`. */
export function endCaptureDrag(): void {
  if (!activeDrag) return;
  activeDrag = null;
  notify();
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

/**
 * Build a capture payload out of a drag that was not started for us.
 *
 * File-tree rows and editor selections already publish structured MIMEs for the
 * composer. Reading them here means Issues becomes a drop target for both
 * without editing either surface.
 *
 * Only safe from `drop` and `dragstart` — `dragover` cannot read the transfer.
 */
export function capturePayloadFromDataTransfer(
  dataTransfer: DataTransfer | null,
): CapturePayload | null {
  if (!dataTransfer) return null;

  const own = parseCaptureDragData(dataTransfer);
  if (own) return own;

  const types = Array.from(dataTransfer.types);

  if (types.includes(CODE_SELECTION_MIME)) {
    const selection = parseCodeSelectionDragData(dataTransfer);
    if (selection) {
      const label = formatCodeRefLabel(
        selection.workspacePath,
        selection.startLine,
        selection.endLine,
      );
      return {
        sourceLabel: 'Editor selection',
        workspacePath: undefined,
        items: [
          {
            kind: 'code',
            label,
            codeRef: {
              path: selection.workspacePath,
              startLine: selection.startLine,
              endLine: selection.endLine,
              snippet: selection.text.slice(0, 2000),
            },
            text: selection.text,
          },
        ],
      };
    }
  }

  if (types.includes(WORKSPACE_FILE_MIME)) {
    const path = dataTransfer.getData(WORKSPACE_FILE_MIME).trim();
    if (path) {
      return {
        sourceLabel: 'Workspace file',
        items: [
          {
            kind: 'file',
            label: basename(path),
            detail: path,
            codeRef: { path },
          },
        ],
      };
    }
  }

  return null;
}

/** True when a drag *might* be capturable, judged from types alone (dragover-safe). */
export function dataTransferLooksCapturable(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types);
  return (
    types.includes(ISSUE_CAPTURE_MIME) ||
    types.includes(CODE_SELECTION_MIME) ||
    types.includes(WORKSPACE_FILE_MIME)
  );
}

/**
 * Bind the document-level listeners once.
 *
 * Bubble-phase `dragstart` so file-tree and editor handlers set MIME types
 * before the descriptor is read; bubble-phase `dragend`/`drop` so it survives
 * until every target has had its turn.
 */
export function initCaptureDragLayer(): void {
  if (layerBound || typeof document === 'undefined') return;
  layerBound = true;

  document.addEventListener('dragstart', (event) => {
    if (activeDrag) return;
    const payload = capturePayloadFromDataTransfer(event.dataTransfer);
    if (!payload) return;
    activeDrag = payload;
    document.documentElement.classList.add('mn-capture-dragging');
    notify();
  });

  const clear = (): void => {
    document.documentElement.classList.remove('mn-capture-dragging');
    endCaptureDrag();
  };
  document.addEventListener('dragend', clear);
  document.addEventListener('drop', clear);
}

/** Reset module state (tests). */
export function resetCaptureDragForTests(): void {
  activeDrag = null;
  layerBound = false;
  listeners.clear();
}
