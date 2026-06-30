/**
 * Detect OS file drags (Windows Explorer, Finder, etc.) vs internal workspace drags.
 */

import { WORKSPACE_FILE_MIME } from './workspace-ref';

export type DragKind = 'external' | 'workspace';

/** True when the drag carries native OS files (Explorer, Finder, desktop). */
export function hasExternalFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const types = dataTransfer.types;
  if (types.includes('Files')) return true;
  return dataTransfer.files.length > 0;
}

/** True when the drag originated from the Minnow file tree (workspace-relative path). */
export function hasWorkspaceFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  if (dataTransfer.types.includes(WORKSPACE_FILE_MIME)) return true;
  const plain = dataTransfer.getData('text/plain').trim();
  if (plain && !plain.includes('\n') && plain.length <= 512) return true;
  return false;
}

/**
 * Classify an incoming drag. External OS files take precedence over plain-text paths
 * (Explorer often sets both `Files` and `text/plain` / `text/uri-list`).
 */
export function classifyFileDrag(dataTransfer: DataTransfer | null): DragKind | null {
  if (!dataTransfer) return null;
  if (hasExternalFileDrag(dataTransfer) && !dataTransfer.types.includes(WORKSPACE_FILE_MIME)) {
    return 'external';
  }
  if (hasWorkspaceFileDrag(dataTransfer)) return 'workspace';
  return null;
}

/** File list from a completed drop event (directories are skipped by callers). */
export function filesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  const out: File[] = [];
  for (let i = 0; i < dataTransfer.files.length; i += 1) {
    const file = dataTransfer.files[i];
    if (file) out.push(file);
  }
  return out;
}

/** Skip directory entries when the platform exposes them as zero-byte File items. */
export function isLikelyDirectoryDrop(file: File): boolean {
  if (file.type === '') {
    const name = file.name;
    if (!name.includes('.') || name.endsWith('.')) return true;
  }
  return false;
}
