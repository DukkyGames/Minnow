export interface FileTreeClipboard {
  mode: 'copy' | 'cut';
  paths: string[];
}

let clipboard: FileTreeClipboard | null = null;

export function getFileTreeClipboard(): FileTreeClipboard | null {
  return clipboard;
}

export function setFileTreeClipboard(mode: 'copy' | 'cut', paths: string[]): void {
  clipboard = { mode, paths };
}

export function clearFileTreeClipboard(): void {
  clipboard = null;
}
