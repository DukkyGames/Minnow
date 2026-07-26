/**
 * Notify session SSE subscribers after a sessions write (PUT or PATCH).
 */

import { bumpSessionRev } from './rev-store.js';
import { publishSessionPatch } from './sse.js';

/**
 * @param {unknown} state
 * @returns {number} new revision
 */
export function notifySessionStateWritten(state) {
  const rev = bumpSessionRev(state);
  publishSessionPatch(rev, state);
  return rev;
}
