/**
 * Shared file attachment preview cards (icon badge, name, size) for composer + history.
 * MIN-410.
 */

import { fileExtension, isOfficeExtension } from './document-extensions.mjs';
import type { AttachmentKind } from './types';

/** Visual bucket for the 28×28 type badge tint. */
export type FileCardVariant = 'code' | 'pdf' | 'doc' | 'file';

export interface FileCardMeta {
  /** Short uppercase label inside the badge (e.g. TS, PDF). */
  badge: string;
  variant: FileCardVariant;
}

/** Human-readable byte size for attachment chips. */
export function formatAttachmentBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Size line on a chip; workspace refs stay readable before send resolves bytes. */
export function formatFileCardSizeLabel(
  size: number,
  options?: { workspace?: boolean },
): string {
  if (options?.workspace && size <= 0) return 'Workspace';
  return formatAttachmentBytes(size);
}

/** Maps filename + attachment kind to badge label and tint variant. */
export function getFileCardMeta(name: string, kind: AttachmentKind): FileCardMeta {
  const ext = fileExtension(name);
  const baseName = (name.split(/[/\\]/).pop() ?? name).toLowerCase();

  if (kind === 'pdf' || ext === 'pdf') {
    return { badge: 'PDF', variant: 'pdf' };
  }

  if (isOfficeExtension(name)) {
    const badge = ext ? ext.slice(0, 4).toUpperCase() : 'DOC';
    return { badge, variant: 'doc' };
  }

  if (baseName === 'dockerfile') {
    return { badge: 'DF', variant: 'code' };
  }
  if (baseName === 'makefile') {
    return { badge: 'MK', variant: 'code' };
  }

  if (kind === 'text' && ext) {
    return { badge: ext.slice(0, 4).toUpperCase(), variant: 'code' };
  }

  if (ext) {
    return { badge: ext.slice(0, 4).toUpperCase(), variant: 'file' };
  }

  return { badge: 'FILE', variant: 'file' };
}

/** Infer attachment kind from a persisted history filename when live metadata is gone. */
export function inferFileKindFromName(name: string): 'text' | 'pdf' {
  return fileExtension(name) === 'pdf' ? 'pdf' : 'text';
}

/** Byte length of inlined file body for size display in history bubbles. */
export function estimateTextByteSize(body: string): number {
  return new TextEncoder().encode(body).length;
}

/** 28×28 extension/type badge for file attachment cards. */
export function createFileTypeIcon(meta: FileCardMeta): HTMLSpanElement {
  const icon = document.createElement('span');
  icon.className = `attach-file-icon attach-file-icon--${meta.variant}`;
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = meta.badge;
  return icon;
}

export interface FileCardBodyOptions {
  name: string;
  size: number;
  kind: AttachmentKind;
  /** When true, show "Workspace" instead of 0 B for unresolved workspace refs. */
  workspaceRef?: boolean;
  /** Optional class overrides for composer vs message chip contexts. */
  nameClass?: string;
  sizeClass?: string;
  stackClass?: string;
}

/** Name + size column paired with a type badge — shared by composer and message chips. */
export function createFileCardBody(options: FileCardBodyOptions): {
  icon: HTMLSpanElement;
  stack: HTMLSpanElement;
} {
  const meta = getFileCardMeta(options.name, options.kind);
  const icon = createFileTypeIcon(meta);

  const stack = document.createElement('span');
  stack.className = options.stackClass ?? 'attach-file-stack';

  const nameEl = document.createElement('span');
  nameEl.className = options.nameClass ?? 'attach-file-name';
  nameEl.textContent = options.name;

  const sizeEl = document.createElement('span');
  sizeEl.className = options.sizeClass ?? 'attach-file-size';
  sizeEl.textContent = formatFileCardSizeLabel(options.size, {
    workspace: options.workspaceRef,
  });

  stack.append(nameEl, sizeEl);
  return { icon, stack };
}
