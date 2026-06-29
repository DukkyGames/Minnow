/**
 * Node-only helpers for parsing VALID_COMMANDS from vendored pin.mjs (sync / patch scripts).
 * Browser code must import harness-registry.mjs instead — no node:fs / node:url here in the client bundle.
 */

import fs from 'node:fs';

/**
 * Parse VALID_COMMANDS from pin.mjs without executing its CLI entrypoint.
 * @param {string} pinPath
 * @returns {string[]}
 */
export function parseValidCommandsFromPin(pinPath) {
  const source = fs.readFileSync(pinPath, 'utf8');
  const match = source.match(/const\s+VALID_COMMANDS\s*=\s*\[([\s\S]*?)\];/);
  if (!match) {
    throw new Error(`Could not parse VALID_COMMANDS from ${pinPath}`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}
