/**
 * Preview guest load URLs without pulling in the full preview panel / file editor graph.
 */

import type { PreviewSource } from '../state/file-panel';
import { withSessionToken } from '../api/session-token.ts';

const PREVIEW_FILE_API = '/api/preview/file/';
const PREVIEW_DOCUMENT_HTML_API = '/api/preview/document-html/';

function normalizeWorkspacePath(input: string): string {
  return input.replace(/^\/+/, '').trim();
}

function appendQueryParam(url: string, key: string, value: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${key}=${encodeURIComponent(value)}`;
}

export interface WorkspacePreviewUrlOptions {
  cacheBust?: number;
  workspaceRoot?: string;
  /**
   * Skip HTML `<base>` injection (file viewer / editor loads).
   * Browser preview must leave this unset so relative assets resolve.
   */
  raw?: boolean;
}

/** Build preview URL for a workspace-relative path (path only; use resolvePreviewLoadUrl for absolute). */
export function workspacePreviewUrl(
  relativePath: string,
  cacheBust?: number,
  workspaceRoot?: string,
): string;
export function workspacePreviewUrl(
  relativePath: string,
  options?: WorkspacePreviewUrlOptions,
): string;
export function workspacePreviewUrl(
  relativePath: string,
  cacheBustOrOptions?: number | WorkspacePreviewUrlOptions,
  workspaceRoot?: string,
): string {
  const options: WorkspacePreviewUrlOptions =
    typeof cacheBustOrOptions === 'object' && cacheBustOrOptions !== null
      ? cacheBustOrOptions
      : { cacheBust: cacheBustOrOptions, workspaceRoot };
  const normalized = normalizeWorkspacePath(relativePath);
  const encoded = normalized.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  let url = `${PREVIEW_FILE_API}${encoded}`;
  if (options.cacheBust !== undefined) {
    url = appendQueryParam(url, 'v', String(options.cacheBust));
  }
  const root = options.workspaceRoot?.trim();
  if (root) {
    url = appendQueryParam(url, 'workspaceRoot', root);
  }
  if (options.raw) {
    url = appendQueryParam(url, 'raw', '1');
  }
  return withSessionToken(url);
}

/** Build HTML preview URL for spreadsheet/Word workspace files. */
export function workspaceDocumentHtmlUrl(
  relativePath: string,
  cacheBust?: number,
  workspaceRoot?: string,
): string {
  const normalized = normalizeWorkspacePath(relativePath);
  const encoded = normalized.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  let url = `${PREVIEW_DOCUMENT_HTML_API}${encoded}`;
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

/** Absolute URL for spreadsheet/Word HTML preview in the file viewer. */
export function resolveDocumentHtmlLoadUrl(
  relativePath: string,
  cacheBust?: number,
  workspaceRoot?: string,
): string {
  const path = workspaceDocumentHtmlUrl(relativePath, cacheBust, workspaceRoot);
  return `${window.location.origin}${path}`;
}

/** Absolute URL passed to the preview guest (Electron or iframe with full origin). */
export function resolvePreviewLoadUrl(
  source: PreviewSource,
  cacheBust?: number,
  workspaceRoot?: string,
  options?: { raw?: boolean },
): string {
  if (source.kind === 'url') return resolveRootRelativeUrl(source.url);
  const path = workspacePreviewUrl(source.path, {
    cacheBust,
    workspaceRoot,
    raw: options?.raw,
  });
  return `${window.location.origin}${path}`;
}
