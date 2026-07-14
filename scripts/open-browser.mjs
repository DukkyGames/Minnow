#!/usr/bin/env node
/**
 * Open the system default browser for a URL (platform-specific).
 * Shared by server.js and the Electron launcher fallback path.
 */

import { spawn } from 'node:child_process';

/**
 * @param {string} url
 */
export function openBrowser(url) {
  const platform = process.platform;
  let command;
  let args;

  if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}
