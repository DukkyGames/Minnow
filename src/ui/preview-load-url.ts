/**
 * Preview guest load URLs without pulling in the full preview panel / file editor graph.
 */

import type { PreviewSource } from '../state/file-panel';
import { withSessionToken } from '../api/session-token.ts';

const PREVIEW_FILE_API = '/api/preview/file/';

function normalizeWorkspacePath(input: string): string {
  return input.replace(/^\/+/, '').trim();
}

/** Build preview URL for a workspace-relative path (path only; use resolvePreviewLoadUrl for absolute). */
export function workspacePreviewUrl(relativePath: string, cacheBust?: number): string {
  const normalized = normalizeWorkspacePath(relativePath);
  const encoded = normalized.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  const base = `${PREVIEW_FILE_API}${encoded}`;
  const withCacheBust = cacheBust === undefined ? base : `${base}${base.includes('?') ? '&' : '?'}v=${cacheBust}`;
  return withSessionToken(withCacheBust);
}

function resolveRootRelativeUrl(url: string): string {
  if (url.startsWith('/') && !url.startsWith('//')) {
    return `${window.location.origin}${url}`;
  }
  return url;
}

/** Absolute URL passed to the preview guest (Electron or iframe with full origin). */
export function resolvePreviewLoadUrl(source: PreviewSource, cacheBust?: number): string {
  if (source.kind === 'url') return resolveRootRelativeUrl(source.url);
  const path = workspacePreviewUrl(source.path, cacheBust);
  return `${window.location.origin}${path}`;
}
