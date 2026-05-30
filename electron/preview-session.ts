/**
 * Preview guest session: load arbitrary https/http pages inside WebContentsView.
 * Strips embedding-related response headers so any iframes inside the guest can render;
 * top-level navigation goes through Chromium's normal network stack like a regular tab.
 */

import type { Session } from 'electron';

/** Chromium storage partition for the in-app preview guest (isolated from the shell). */
export const PREVIEW_SESSION_PARTITION = 'persist:minnow-preview';

/** Response headers removed so subframe / cross-origin content inside the guest is not blocked. */
const STRIP_RESPONSE_HEADER_NAMES = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
]);

const configuredSessions = new WeakSet<Session>();

/** Remove response headers that block embedded / guest WebContents navigation. */
export function sanitizeEmbedBlockingHeaders(
  responseHeaders: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const headers = { ...responseHeaders };

  for (const key of Object.keys(headers)) {
    if (STRIP_RESPONSE_HEADER_NAMES.has(key.toLowerCase())) {
      delete headers[key];
    }
  }

  return headers;
}

/** Attach header rewriting to the preview Chromium session only. */
export function configurePreviewSession(ses: Session): void {
  if (configuredSessions.has(ses)) return;
  configuredSessions.add(ses);

  ses.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
    if (!details.responseHeaders) {
      callback({});
      return;
    }
    callback({
      responseHeaders: sanitizeEmbedBlockingHeaders(details.responseHeaders),
    });
  });
}
