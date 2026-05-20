/**
 * Workspace file references dragged from the file tree into the composer.
 * File bodies are loaded on send via read_file.
 */

import { executeTool } from '../tools/client';
import {
  getPendingAttachments,
  pushAttachment,
  removeAttachment,
} from './store';
import type { Attachment } from './types';

/** Drag-and-drop MIME type for file-tree → composer transfers. */
export const WORKSPACE_FILE_MIME = 'application/x-speedchat-workspace-file';

/** Minimum pointer movement (px) before a file-tree row starts a drag. */
export const FILE_TREE_DRAG_THRESHOLD_PX = 5;

/** Loads file text for a workspace path (overridable in tests). */
export type WorkspaceFileReader = (path: string) => Promise<string>;

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

/**
 * Reads workspace reference files and returns attachments ready for
 * {@link buildHistoryUserContent} (workspace → text, failures → error).
 */
export async function resolveWorkspaceReferences(
  attachments: Attachment[],
  readFile: WorkspaceFileReader = defaultWorkspaceFileReader,
): Promise<Attachment[]> {
  const resolved: Attachment[] = [];

  for (const attachment of attachments) {
    if (attachment.kind !== 'workspace' || !attachment.workspacePath) {
      resolved.push(attachment);
      continue;
    }

    const path = attachment.workspacePath;
    try {
      const name = basename(path);
      const text = await readFile(path);
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
