/**
 * Filesystem paths for OAuth connections and pending flows.
 */

import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

/** Root OAuth data directory under ~/.minnow/oauth. */
export function oauthRootDir() {
  return path.join(getMinnowHome(), 'oauth');
}

/** Connection registry JSON (no tokens). */
export function oauthConnectionsPath() {
  return path.join(oauthRootDir(), 'connections.json');
}

/** Encrypted token envelope for one connection. */
export function oauthSecretPath(connectionId) {
  return path.join(oauthRootDir(), 'secrets', `${connectionId}.json`);
}

/** Pending PKCE flows (crash recovery). */
export function oauthPendingPath() {
  return path.join(oauthRootDir(), 'pending.json');
}
