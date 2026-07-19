/**
 * Preview guest load URLs without pulling in the full preview panel / file editor graph.
 */

import type { PreviewSource } from '../state/file-panel';
import { withSessionToken } from '../api/session-token.ts';

const PREVIEW_FILE_API = '/api/preview/file/';

function normalizeWorkspacePath(input: string): string {
  return input.replace(/^\/+/, '').trim();
}

function appendQueryParam(url: string, key: string, value: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${key}=${encodeURIComponent(value)}`;
}

/** Build preview URL for a workspace-relative path (path only; use resolvePreviewLoadUrl for absolute). */
export function workspacePreviewUrl(
  relativePath: string,
  cacheBust?: number,
  workspaceRoot?: string,
): string {
  const normalized = normalizeWorkspacePath(relativePath);
  const encoded = normalized.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  let url = `${PREVIEW_FILE_API}${encoded}`;
  if (cacheBust !== undefined) {
    url = appendQueryParam(url, 'v', String(cacheBust));
  }
  const root = workspaceRoot?.trim();
  if (root) {
    url = appendQueryParam(url, 'workspaceRoot', root);
  }
  return withSessionToken(url);
}

function resolveRootRelativeUrl(url: string): string {
  if (url.startsWith('/') && !url.startsWith('//')) {
    return `${window.location.origin}${url}`;
  }
  return url;
}

/** Absolute URL passed to the preview guest (Electron or iframe with full origin). */
export function resolvePreviewLoadUrl(
  source: PreviewSource,
  cacheBust?: number,
  workspaceRoot?: string,
): string {
  if (source.kind === 'url') return resolveRootRelativeUrl(source.url);
  const path = workspacePreviewUrl(source.path, cacheBust, workspaceRoot);
  return `${window.location.origin}${path}`;
}
