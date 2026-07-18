/**
 * Query-string encoding for research report theme + custom color overrides.
 */

import { isCustomThemeEnabled, readEffectiveThemeTokens } from '../appearance/custom-theme';
import { getStoredTheme } from '../theme';

/** Base64url-encode a custom token map for report URLs. */
export function encodeCustomTokensPayload(tokens: Record<string, string>): string {
  const json = JSON.stringify(tokens);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Base64url-encode JSON for a compact, URL-safe custom token payload. */
export function encodeReportCustomTokens(): string | null {
  if (!isCustomThemeEnabled()) {
    return null;
  }
  const tokens = readEffectiveThemeTokens();
  return encodeCustomTokensPayload(tokens);
}

/** Theme-related query params for /api/research/report/:id navigation. */
export function buildResearchReportThemeSearchParams(): URLSearchParams {
  const params = new URLSearchParams();
  params.set('theme', getStoredTheme());
  const encoded = encodeReportCustomTokens();
  if (encoded) {
    params.set('custom', '1');
    params.set('ct', encoded);
  }
  return params;
}
