/**
 * Walk OS folder drops (Explorer / Finder) into a flat list of relative paths.
 *
 * Chromium only exposes nested files through DataTransferItem.webkitGetAsEntry().
 * That getter must run synchronously during the drop handler — after an await it
 * often returns null.
 */

import { filesFromDataTransfer, isLikelyDirectoryDrop } from './external-file-drop';

/** Cap so a huge drop (e.g. node_modules) cannot freeze the UI with thousands of POSTs. */
export const MAX_DROPPED_TREE_ENTRIES = 5000;

/** One file or directory from a drop, relative to the dropped roots (posix, no leading slash). */
export type DroppedTreeEntry = {
  relativePath: string;
  kind: 'file' | 'dir';
  /** Present for files; null for directories. */
  file: File | null;
};

export type DroppedTreeResult = {
  entries: DroppedTreeEntry[];
  error: string | null;
};

/**
 * Strip leading slashes, collapse `.`, and reject `..` so drops cannot escape the dest folder.
 * Returns null when the path is empty or unsafe.
 */
export function sanitizeRelativeDropPath(raw: string): string | null {
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/u, '').trim();
  if (!normalized) return null;
  const parts: string[] = [];
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') return null;
    parts.push(segment);
  }
  if (parts.length === 0) return null;
  return parts.join('/');
}

type EntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (successCallback: (file: File) => void, errorCallback?: (err: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (
      successCallback: (entries: EntryLike[]) => void,
      errorCallback?: (err: DOMException) => void,
    ) => void;
  };
};

/** Read every batch from a directory reader (Chrome often returns ~100 entries per call). */
function readAllDirectoryEntries(dir: EntryLike): Promise<EntryLike[]> {
  const reader = dir.createReader?.();
  if (!reader) return Promise.resolve([]);

  return new Promise((resolve, reject) => {
    const all: EntryLike[] = [];
    const readBatch = (): void => {
      reader.readEntries(
        (batch) => {
          if (!batch.length) {
            resolve(all);
            return;
          }
          all.push(...batch);
          readBatch();
        },
        (err) => reject(err),
      );
    };
    readBatch();
  });
}

function fileFromEntry(entry: EntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    if (typeof entry.file !== 'function') {
      reject(new Error('File entry cannot be read'));
      return;
    }
    entry.file(resolve, reject);
  });
}

/**
 * Capture FileSystemEntry roots from a drop. Call this before any await.
 */
export function captureDroppedRootEntries(dataTransfer: DataTransfer): FileSystemEntry[] {
  const items = dataTransfer.items;
  if (!items?.length) return [];
  const roots: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item || item.kind !== 'file') continue;
    const getter = item.webkitGetAsEntry;
    if (typeof getter !== 'function') continue;
    const entry = getter.call(item);
    if (entry) roots.push(entry);
  }
  return roots;
}

/**
 * Recursively expand directory/file entries into a flat import list.
 * Over-cap drops return no entries so we never write a partial tree.
 */
export async function expandFileSystemEntries(
  roots: FileSystemEntry[],
): Promise<DroppedTreeResult> {
  const entries: DroppedTreeEntry[] = [];
  let overCap = false;

  const walk = async (entry: EntryLike): Promise<void> => {
    if (overCap) return;
    if (entries.length >= MAX_DROPPED_TREE_ENTRIES) {
      overCap = true;
      return;
    }

    const relativePath = sanitizeRelativeDropPath(entry.fullPath || entry.name);
    if (!relativePath) return;

    if (entry.isDirectory) {
      entries.push({ kind: 'dir', relativePath, file: null });
      let children: EntryLike[] = [];
      try {
        children = await readAllDirectoryEntries(entry);
      } catch {
        return;
      }
      for (const child of children) {
        await walk(child);
        if (overCap) return;
      }
      return;
    }

    if (!entry.isFile) return;
    try {
      const file = await fileFromEntry(entry);
      entries.push({ kind: 'file', relativePath, file });
    } catch {
      /* Skip unreadable files (locked, permission, broken symlink). */
    }
  };

  for (const root of roots) {
    await walk(root as unknown as EntryLike);
    if (overCap) break;
  }

  if (overCap) {
    return {
      entries: [],
      error: `This folder is too large to import (more than ${MAX_DROPPED_TREE_ENTRIES} items).`,
    };
  }

  return { entries, error: null };
}

/**
 * Fallback when webkitGetAsEntry is missing: use the File list (flat files, or
 * nested paths when webkitRelativePath is set by a directory file input).
 */
export function entriesFromFileList(files: File[]): DroppedTreeResult {
  const entries: DroppedTreeEntry[] = [];
  let skippedFolders = 0;

  for (const file of files) {
    const nested =
      typeof file.webkitRelativePath === 'string' ? file.webkitRelativePath.trim() : '';
    const raw = nested || file.name;
    const relativePath = sanitizeRelativeDropPath(raw);
    if (!relativePath) continue;

    // Directory File objects have no nested listing without the entries API.
    if (!nested && isLikelyDirectoryDrop(file)) {
      skippedFolders += 1;
      continue;
    }

    entries.push({ kind: 'file', relativePath, file });
  }

  if (!entries.length && skippedFolders > 0) {
    return {
      entries: [],
      error: 'Could not read this folder. Drop the files inside it, or use the Minnow desktop app.',
    };
  }

  return { entries, error: null };
}

/**
 * Build the import list from a completed drop event.
 * Captures webkitGetAsEntry roots before yielding so Chromium still has the gesture.
 */
export async function collectDroppedTreeEntries(
  dataTransfer: DataTransfer,
): Promise<DroppedTreeResult> {
  const roots = captureDroppedRootEntries(dataTransfer);
  if (roots.length > 0) {
    return expandFileSystemEntries(roots);
  }
  return entriesFromFileList(filesFromDataTransfer(dataTransfer));
}

/**
 * Directories that would not be created as a side-effect of writing a nested file.
 * import_workspace_file already mkdir -p parents of files.
 */
export function emptyDirectoriesToCreate(entries: DroppedTreeEntry[]): string[] {
  const files = entries.filter((entry) => entry.kind === 'file').map((entry) => entry.relativePath);
  const dirs = entries.filter((entry) => entry.kind === 'dir').map((entry) => entry.relativePath);
  return dirs.filter((dir) => {
    const prefix = `${dir}/`;
    return !files.some((file) => file === dir || file.startsWith(prefix));
  });
}
