/**
 * Resolve memory store paths under SPEEDCHAT_HOME.
 */

import path from 'node:path';
import { getSpeedChatHome } from '../config/home.js';

/** Memory root directory. */
export function getMemoryDir() {
  return path.join(getSpeedChatHome(), 'memory');
}

/** Entry markdown files. */
export function getEntriesDir() {
  return path.join(getMemoryDir(), 'entries');
}

/** Catalog index file. */
export function getIndexPath() {
  return path.join(getMemoryDir(), 'index.json');
}

/** Backups directory for memory archives. */
export function getBackupsDir() {
  return path.join(getSpeedChatHome(), 'backups');
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate entry id (UUID v4 style). */
export function isValidEntryId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

/** Safe entry file path for a validated id. */
export function entryFilePath(id) {
  if (!isValidEntryId(id)) {
    throw new Error('Invalid memory entry id');
  }
  return path.join(getEntriesDir(), `${id}.md`);
}
