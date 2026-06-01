/**
 * Loads workspace image bytes via the preview file API (binary-safe).
 */

import { resolvePreviewLoadUrl } from '../ui/preview-panel';
import { MAX_ATTACHMENT_BYTES } from './reader';
import { mimeTypeForImagePath } from './image-path';

/** Converts a Blob to a data URL for vision / chip thumbnails. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () =>
      reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
}

export interface WorkspaceImagePayload {
  dataUrl: string;
  mimeType: string;
  size: number;
}

/** Fetches a workspace image through GET /api/preview/file/… */
export async function readWorkspaceImage(path: string): Promise<WorkspaceImagePayload> {
  const url = resolvePreviewLoadUrl({ kind: 'workspace', path });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not read image (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  if (blob.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Image exceeds ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit`);
  }
  const dataUrl = await blobToDataUrl(blob);
  return {
    dataUrl,
    mimeType: mimeTypeForImagePath(path),
    size: blob.size,
  };
}
