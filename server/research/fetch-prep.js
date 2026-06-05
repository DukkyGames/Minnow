/**
 * Research-specific URL validation before unattended page fetch (Phase 3 extractor).
 */

import { assertPublicUrl } from '../../src/lib/assert-public-url.mjs';

/**
 * SSRF gate for research fetches — use before fetching arbitrary search result URLs.
 * @param {string} urlString
 * @returns {Promise<URL>}
 */
export async function prepareResearchFetchUrl(urlString) {
  return assertPublicUrl(urlString);
}
