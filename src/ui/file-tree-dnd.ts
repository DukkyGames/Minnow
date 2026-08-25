/**
 * File-tree drag-and-drop: internal moves + OS file/folder import into workspace folders.
 *
 * Robustness note: browsers track drop-allowance per DOM element and clear it on
 * `dragleave`, so a `drop` event may never fire even when the last `dragover` was
 * allowed (the item snaps back). The `dragend` handler therefore falls back to
 * resolving the release point via `document.elementFromPoint` and performs the
 * move itself when no `drop` was handled.
 */

import { collectDroppedTreeEntries } from '../attachments/directory-drop';
import { classifyFileDrag } from '../attachments/external-file-drop';
import { WORKSPACE_FILE_MIME } from '../attachments/workspace-ref';
import { basename, computeMoveDestination } from './file-tree-path';
import { getLocalServerAvailable } from '../tools/client';
import { expandDir } from './file-tree';
import { importDroppedEntriesToWorkspace } from './import-external-files';
import { movePath } from './file-tree-ops';
import { setStatus } from './status';

const DROP_TARGET_CLASS = 'file-tree-row--drop-target';
const HOST_DROP_CLASS = 'file-tree-host--drop-target';

let hostBound: HTMLElement | null = null;
let moveInFlight = false;
/** Set on dragstart; dragover cannot read DataTransfer.getData in most browsers. */
let activeDragSourcePath: string | null = null;
/** Set when the `drop` handler dispatches a move/import; the dragend fallback skips when true. */
let dropHandled = false;

/* ------------------------------------------------------------------ *
 * Diagnostic logging (temporary — remove once the drop failure is
 * confirmed fixed). Every gate that can veto a drop logs its reason so a
 * failed drag produces a readable trace in the dev console:
 *   dragstart → dragover (deduped) → drop → move result → dragend
 * ------------------------------------------------------------------ */
const LOG_PREFIX = '[file-tree-dnd]';
function log(msg: string, ...rest: unknown[]): void {
  console.log(LOG_PREFIX, msg, ...rest);
}
let lastDragoverDecision = '';
/** dragover fires many times per second; only log when the decision changes. */
function logDragover(decision: string, detail?: unknown): void {
  const key = `${decision}:${detail === undefined ? '' : JSON.stringify(detail)}`;
  if (key === lastDragoverDecision) return;
  lastDragoverDecision = key;
  log('dragover →', decision, detail ?? '');
}
function resetDragoverLog(): void {
  lastDragoverDecision = '';
}
function typesOf(dt: DataTransfer | null): string[] {
  if (!dt) return [];
  return Array.from(dt.types);
}

const elementTokens = new WeakMap<Element, number>();
let nextElementToken = 1;
/**
 * Stable per-DOM-node id. The SAME path with DIFFERENT tokens means the row
 * element was destroyed and recreated (re-render churn) — which loses the
 * browser's pending drop. The SAME token across enter/leave means plain cursor
 * movement (or child-boundary noise), not churn.
 */
function elementToken(el: Element | null): number | null {
  if (!el) return null;
  let tok = elementTokens.get(el);
  if (tok === undefined) {
    tok = nextElementToken++;
    elementTokens.set(el, tok);
  }
  return tok;
}

let docDropBound = false;
/**
 * Global probe (capture): log ANY `drop` the browser fires, on which element,
 * and whether it's inside the file tree. If this never logs during a drag even
 * though `dragover` was `*-drop-allowed`, the browser is not allowing the drop
 * at all — the dragend fallback below covers that case.
 */
function bindDocumentDropProbe(): void {
  if (docDropBound || typeof document === 'undefined') return;
  docDropBound = true;
  document.addEventListener(
    'drop',
    (event) => {
      const t = event.target as HTMLElement | null;
      const row = (t?.closest('.file-tree-row[data-path]') as HTMLElement | null) ?? null;
      log('PROBE document drop fired:', {
        targetPath: row?.dataset.path ?? null,
        targetToken: elementToken(row),
        targetClass: t?.className ?? null,
        inTree: !!t?.closest('#fileTreeHost'),
      });
    },
    true,
  );
}

function hasWorkspaceDrag(dataTransfer: DataTransfer | null): boolean {
  return classifyFileDrag(dataTransfer) === 'workspace';
}

function hasExternalDrag(dataTransfer: DataTransfer | null): boolean {
  return classifyFileDrag(dataTransfer) === 'external';
}

function hasTreeDrag(dataTransfer: DataTransfer | null): boolean {
  return classifyFileDrag(dataTransfer) !== null;
}

function pathFromDataTransfer(dataTransfer: DataTransfer): string | null {
  const typed = dataTransfer.getData(WORKSPACE_FILE_MIME).trim();
  if (typed) return typed;
  const plain = dataTransfer.getData('text/plain').trim();
  if (!plain || plain.includes('\n') || plain.length > 512) return null;
  return plain;
}

function folderRowFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const row = target.closest('.file-tree-row--dir');
  return row instanceof HTMLElement ? row : null;
}

function clearDropHighlight(host: HTMLElement): void {
  host.classList.remove(HOST_DROP_CLASS);
  for (const row of host.querySelectorAll(`.${DROP_TARGET_CLASS}`)) {
    row.classList.remove(DROP_TARGET_CLASS);
  }
}

/**
 * Core internal move: validate + move `source` into `destDir`. Shared by the
 * `drop` handler and the `dragend` fallback.
 */
async function performTreeMove(source: string, destDir: string): Promise<void> {
  const destination = computeMoveDestination(source, destDir);
  log('tree move: computed destination =', destination, { source, destDir });
  if (!destination) {
    if (basename(source) && destDir === source) {
      return;
    }
    setStatus('err', 'Cannot move a folder into itself or its subfolder.');
    return;
  }

  moveInFlight = true;
  try {
    const ok = await movePath(source, destination, 'move');
    log('tree move: movePath result =', ok, { source, destination });
    if (ok) {
      void expandDir(destDir);
    }
  } finally {
    moveInFlight = false;
  }
}

async function handleTreeDrop(
  event: DragEvent,
  targetRow: HTMLElement,
): Promise<void> {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) {
    log('tree drop: bail — no dataTransfer');
    return;
  }

  const source = activeDragSourcePath?.trim() || (dataTransfer ? pathFromDataTransfer(dataTransfer) : null) || '';
  const destDir = targetRow.dataset.path;
  log('tree drop:', { source, destDir, destToken: elementToken(targetRow) });
  if (!source || !destDir) {
    log('tree drop: bail — missing source or destDir');
    return;
  }

  dropHandled = true;
  await performTreeMove(source, destDir);
}

async function handleExternalTreeDrop(
  event: DragEvent,
  destDir: string,
): Promise<void> {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) {
    log('external drop: bail — no dataTransfer');
    return;
  }

  // collectDroppedTreeEntries captures webkitGetAsEntry before its first await.
  const { entries, error } = await collectDroppedTreeEntries(dataTransfer);
  log('external drop:', { destDir, entries: entries.length, error: error ?? null });
  if (!entries.length) {
    setStatus('err', error ?? 'Nothing to import from this drop.');
    return;
  }

  moveInFlight = true;
  try {
    const result = await importDroppedEntriesToWorkspace(entries, destDir);
    log('external drop: import result =', result);
    if (result.imported > 0 || result.directories > 0) {
      void expandDir(destDir);
    }
  } finally {
    moveInFlight = false;
  }
}

function pathFromDragRow(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) return null;
  const row = target.closest('.file-tree-row[data-path]');
  if (!(row instanceof HTMLElement)) return null;
  const path = row.dataset.path?.trim();
  return path || null;
}

function bindHost(host: HTMLElement): void {
  host.addEventListener(
    'dragstart',
    (event) => {
      activeDragSourcePath = pathFromDragRow(event.target);
      dropHandled = false;
      const row = (event.target as HTMLElement | null)?.closest('.file-tree-row[data-path]') as
        | HTMLElement
        | null;
      log('dragstart:', {
        source: activeDragSourcePath,
        sourceToken: elementToken(row),
        targetClass: (event.target as HTMLElement | null)?.className ?? null,
      });
      resetDragoverLog();
    },
    true,
  );

  // Churn detection: log the row's element token + the exact target element.
  // Same path + different token across enter/leave = row recreated (churn).
  // Same token = plain cursor / child-boundary movement.
  host.addEventListener('dragenter', (event) => {
    const t = event.target as HTMLElement | null;
    const row = (t?.closest('.file-tree-row[data-path]') as HTMLElement | null) ?? null;
    log('dragenter:', { path: row?.dataset.path ?? null, token: elementToken(row), target: t?.className ?? null });
  });
  host.addEventListener('dragleave', (event) => {
    const t = event.target as HTMLElement | null;
    const row = (t?.closest('.file-tree-row[data-path]') as HTMLElement | null) ?? null;
    log('dragleave:', { path: row?.dataset.path ?? null, token: elementToken(row), target: t?.className ?? null });
  });

  host.addEventListener('dragover', (event) => {
    if (moveInFlight || !getLocalServerAvailable()) {
      logDragover('skip', moveInFlight ? 'moveInFlight' : 'serverUnavailable');
      return;
    }
    if (!hasTreeDrag(event.dataTransfer)) {
      logDragover('skip', { reason: 'notATreeDrag', types: typesOf(event.dataTransfer) });
      return;
    }

    if (hasExternalDrag(event.dataTransfer)) {
      const row = folderRowFromTarget(event.target);
      const destDir = row?.dataset.path ?? '.';
      if (!destDir) {
        logDragover('skip', { reason: 'external-noDestDir' });
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      clearDropHighlight(host);
      if (row) {
        row.classList.add(DROP_TARGET_CLASS);
      } else {
        host.classList.add(HOST_DROP_CLASS);
      }
      logDragover('external-drop-allowed', { destDir, token: elementToken(row) });
      return;
    }

    if (!hasWorkspaceDrag(event.dataTransfer)) {
      logDragover('skip', { reason: 'notWorkspace', types: typesOf(event.dataTransfer) });
      return;
    }

    const row = folderRowFromTarget(event.target);
    if (!row?.dataset.path) {
      logDragover('skip', {
        reason: 'noFolderRowUnderCursor',
        targetClass: (event.target as HTMLElement | null)?.className ?? null,
      });
      return;
    }

    const source = activeDragSourcePath?.trim() ?? '';
    if (!source) {
      logDragover('skip', { reason: 'noActiveDragSource' });
      return;
    }

    const destination = computeMoveDestination(source, row.dataset.path);
    if (!destination) {
      logDragover('skip', { reason: 'invalidDestination', source, destDir: row.dataset.path });
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    clearDropHighlight(host);
    row.classList.add(DROP_TARGET_CLASS);
    logDragover('workspace-drop-allowed', {
      source,
      destDir: row.dataset.path,
      destination,
      token: elementToken(row),
    });
  });

  host.addEventListener('dragleave', (event) => {
    const row = folderRowFromTarget(event.target);
    if (row) {
      const related = event.relatedTarget;
      if (related instanceof Node && row.contains(related)) return;
      row.classList.remove(DROP_TARGET_CLASS);
      return;
    }
    if (event.target === host) {
      host.classList.remove(HOST_DROP_CLASS);
    }
  });

  host.addEventListener('drop', (event) => {
    clearDropHighlight(host);
    if (moveInFlight || !getLocalServerAvailable()) {
      log('drop: bail —', moveInFlight ? 'moveInFlight' : 'serverUnavailable');
      return;
    }
    if (!hasTreeDrag(event.dataTransfer)) {
      log('drop: bail — notATreeDrag', { types: typesOf(event.dataTransfer) });
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (hasExternalDrag(event.dataTransfer)) {
      const row = folderRowFromTarget(event.target);
      const destDir = row?.dataset.path ?? '.';
      dropHandled = true;
      log('drop: external branch', { destDir, token: elementToken(row) });
      void handleExternalTreeDrop(event, destDir);
      return;
    }

    if (!hasWorkspaceDrag(event.dataTransfer)) {
      log('drop: bail — notWorkspace', { types: typesOf(event.dataTransfer) });
      return;
    }

    const row = folderRowFromTarget(event.target);
    if (!row?.dataset.path) {
      log('drop: bail — no folder row under cursor', {
        targetClass: (event.target as HTMLElement | null)?.className ?? null,
      });
      return;
    }

    log('drop: workspace branch', { source: activeDragSourcePath, destDir: row.dataset.path, token: elementToken(row) });
    void handleTreeDrop(event, row);
  });

  host.addEventListener('dragend', (event) => {
    // Where did the cursor actually release? elementFromPoint at the dragend
    // coords reveals the true drop target even when no `drop` event fired.
    const under = (typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(event.clientX, event.clientY)
      : null) as HTMLElement | null;
    const row = (under?.closest('.file-tree-row[data-path]') as HTMLElement | null) ?? null;
    log('dragend:', {
      source: activeDragSourcePath,
      dropHandled,
      underPath: row?.dataset.path ?? null,
      underToken: elementToken(row),
      underClass: under?.className ?? null,
      at: { x: event.clientX, y: event.clientY },
    });

    // Fallback: the browser never fired `drop` (a `dragleave` cleared the
    // per-element drop-allowed state first). Resolve the release point and
    // perform the move ourselves so the item does not snap back.
    const source = activeDragSourcePath?.trim() ?? '';
    if (!dropHandled && source) {
      const destRow = (under?.closest('.file-tree-row--dir') as HTMLElement | null) ?? null;
      const serverOk = getLocalServerAvailable();
      if (destRow?.dataset.path && host.contains(destRow) && serverOk && !moveInFlight) {
        log('dragend: no drop fired — elementFromPoint fallback move', {
          source,
          destDir: destRow.dataset.path,
          destToken: elementToken(destRow),
        });
        void performTreeMove(source, destRow.dataset.path);
      } else {
        log('dragend: no drop fired, no valid folder under cursor — no-op', {
          underPath: row?.dataset.path ?? null,
          underClass: under?.className ?? null,
          serverAvailable: serverOk,
          moveInFlight,
        });
      }
    }

    activeDragSourcePath = null;
    dropHandled = false;
    clearDropHighlight(host);
  });
}

/**
 * Wire folder drop targets on the file tree host (idempotent).
 */
export function initFileTreeDnD(): void {
  bindDocumentDropProbe();
  const host = document.getElementById('fileTreeHost');
  if (!host || host === hostBound) return;
  hostBound = host;
  bindHost(host);
  log('bound host listeners on #fileTreeHost');
}

/** Clear binding state (tests). */
export function resetFileTreeDnDForTests(): void {
  hostBound = null;
  moveInFlight = false;
  activeDragSourcePath = null;
  dropHandled = false;
  docDropBound = false;
  resetDragoverLog();
}