/**
 * Editor selection → composer drag payload (path + line range + snippet).
 */

/** Drag-and-drop MIME for CodeMirror selection → composer codeRef chips. */
export const CODE_SELECTION_MIME = 'application/x-minnow-code-selection';

export interface CodeSelectionDragPayload {
  workspacePath: string;
  startLine: number;
  endLine: number;
  text: string;
}

/** True when the drag carries an editor code-selection payload. */
export function hasCodeSelectionDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return dataTransfer.types.includes(CODE_SELECTION_MIME);
}

/** Encode selection metadata for dragstart (also sets text/plain to the snippet). */
export function setCodeSelectionDragData(
  dataTransfer: DataTransfer,
  payload: CodeSelectionDragPayload,
): void {
  const path = payload.workspacePath.trim().replace(/\\/g, '/');
  const startLine = Math.max(1, payload.startLine);
  const endLine = Math.max(startLine, payload.endLine);
  const text = payload.text;
  const json = JSON.stringify({
    workspacePath: path,
    startLine,
    endLine,
    text,
  } satisfies CodeSelectionDragPayload);
  dataTransfer.setData(CODE_SELECTION_MIME, json);
  dataTransfer.setData('text/plain', text);
  dataTransfer.effectAllowed = 'copy';
}

/** Read a code-selection payload from a completed drop event. */
export function parseCodeSelectionDragData(
  dataTransfer: DataTransfer,
): CodeSelectionDragPayload | null {
  const raw = dataTransfer.getData(CODE_SELECTION_MIME).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CodeSelectionDragPayload>;
    const workspacePath = String(parsed.workspacePath ?? '').trim().replace(/\\/g, '/');
    const startLine = Number(parsed.startLine);
    const endLine = Number(parsed.endLine);
    const text = String(parsed.text ?? '');
    if (!workspacePath || !text.trim() || !Number.isFinite(startLine) || !Number.isFinite(endLine)) {
      return null;
    }
    return {
      workspacePath,
      startLine: Math.max(1, startLine),
      endLine: Math.max(Math.max(1, startLine), endLine),
      text,
    };
  } catch {
    return null;
  }
}
