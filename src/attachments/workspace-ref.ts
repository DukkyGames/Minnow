/**
 * Workspace file references dragged from the file tree into the composer.
 * Text files load on send via read_file; images use the preview file API.
 */

import { executeTool } from '../tools/client';
import { isImageFilePath } from './image-path';
import {
  getPendingAttachments,
  pushAttachment,
  removeAttachment,
} from './store';
import type { Attachment } from './types';
import {
  readWorkspaceImage,
  type WorkspaceImagePayload,
} from './workspace-image-read';

/** Drag-and-drop MIME type for file-tree → composer transfers. */
export const WORKSPACE_FILE_MIME = 'application/x-minnow-workspace-file';

/** Loads file text for a workspace path (overridable in tests). */
export type WorkspaceFileReader = (path: string) => Promise<string>;

/** Loads image bytes as a data URL (overridable in tests). */
export type WorkspaceImageReader = (path: string) => Promise<WorkspaceImagePayload>;

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || path;
}

function newWorkspaceAttachmentId(): string {
  return `ws-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Queues a workspace path chip in the composer (deduped by path). */
export function addWorkspaceReference(workspacePath: string): void {
  const path = workspacePath.trim();
  if (!path) return;

  const duplicate = getPendingAttachments().some(
    (item) => item.kind === 'workspace' && item.workspacePath === path,
  );
  if (duplicate) return;

  pushAttachment({
    id: newWorkspaceAttachmentId(),
    name: basename(path),
    kind: 'workspace',
    mimeType: WORKSPACE_FILE_MIME,
    size: 0,
    workspacePath: path,
  });
}

/** Removes a workspace reference chip by attachment id. */
export function removeWorkspaceReference(id: string): void {
  removeAttachment(id);
}

async function defaultWorkspaceFileReader(path: string): Promise<string> {
  const result = await executeTool('read_file', { path });
  return result.content ?? '';
}

async function defaultWorkspaceImageReader(path: string): Promise<WorkspaceImagePayload> {
  return readWorkspaceImage(path);
}

/**
 * Reads workspace reference files and returns attachments ready for
 * {@link buildHistoryUserContent} (images → kind image, text → kind text, failures → error).
 */
export async function resolveWorkspaceReferences(
  attachments: Attachment[],
  readText: WorkspaceFileReader = defaultWorkspaceFileReader,
  readImage: WorkspaceImageReader = defaultWorkspaceImageReader,
): Promise<Attachment[]> {
  const resolved: Attachment[] = [];

  for (const attachment of attachments) {
    if (attachment.kind !== 'workspace' || !attachment.workspacePath) {
      resolved.push(attachment);
      continue;
    }

    const path = attachment.workspacePath;
    const name = basename(path);
    try {
      if (isImageFilePath(path)) {
        const { dataUrl, mimeType, size } = await readImage(path);
        resolved.push({
          ...attachment,
          kind: 'image',
          name,
          mimeType,
          size,
          dataUrl,
        });
        continue;
      }

      const text = await readText(path);
      resolved.push({
        ...attachment,
        kind: 'text',
        name,
        mimeType: 'text/plain',
        text,
        largeTextWarning: text.length > 32 * 1024,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not read workspace file';
      resolved.push({
        ...attachment,
        kind: 'error',
        error: message,
      });
    }
  }

  return resolved;
}
