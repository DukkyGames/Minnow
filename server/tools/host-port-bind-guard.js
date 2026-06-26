/**
 * Block agent shell commands that would bind a dev server to Minnow's live port.
 * Complements host-kill-guard (which blocks killing the host). Agent path only.
 */

import { resolveMinnowPort } from '../constants/minnow-port.js';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when the command sets a listen port to the live Minnow host port. */
function commandBindsLivePort(command, port) {
  const p = escapeRegex(port);
  const bindPatterns = [
    new RegExp(`\\bPORT\\s*=\\s*${p}\\b`, 'i'),
    new RegExp(`\\$env:PORT\\s*=\\s*${p}\\b`, 'i'),
    new RegExp(`\\bset\\s+PORT\\s*=\\s*${p}\\b`, 'i'),
    new RegExp(`\\bVITE_PORT\\s*=\\s*${p}\\b`, 'i'),
    new RegExp(`\\$env:VITE_PORT\\s*=\\s*${p}\\b`, 'i'),
    new RegExp(`(?:--port(?:=|\\s+)|-p)${p}\\b`, 'i'),
    new RegExp(`\\blisten\\s+${p}\\b`, 'i'),
  ];
  return bindPatterns.some((re) => re.test(command));
}

function hostPortBindError(port) {
  return [
    `Error: refusing to run a command that binds a dev server to port ${port}`,
    '— that port hosts the running Minnow app.',
    'Use the board-injected PORT / VITE_PORT env vars, or pick another port (e.g. Vite default 5173).',
    'Do not start Minnow itself (`node server.js` / `npm start` in the Minnow repo).',
  ].join(' ');
}

/**
 * @param {string} command
 * @returns {string | null}
 */
export function assessHostPortBindCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const text = command.trim();
  const port = String(resolveMinnowPort());
  if (!commandBindsLivePort(text, port)) return null;
  return hostPortBindError(port);
}
