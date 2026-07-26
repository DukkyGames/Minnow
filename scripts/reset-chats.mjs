/**
 * Delete every chat from the local session store (sessions.db + state.json).
 *
 * Quit Minnow first — the running app holds the session state in memory and will
 * write it back over anything this script changes.
 *
 * Usage: node scripts/reset-chats.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const home = process.env.MINNOW_HOME || path.join(os.homedir(), '.minnow');
const sessionsDir = path.join(home, 'sessions');
const dbPath = path.join(sessionsDir, 'sessions.db');
const statePath = path.join(sessionsDir, 'state.json');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(home, 'backups', `sessions-${stamp}`);
fs.mkdirSync(backupDir, { recursive: true });
for (const file of [dbPath, statePath]) {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(backupDir, path.basename(file)));
  }
}
console.log(`[reset-chats] backup -> ${backupDir}`);

if (fs.existsSync(dbPath)) {
  const db = new Database(dbPath);
  // Child tables first; some builds predate ON DELETE CASCADE.
  const tables = [
    'messages',
    'chat_terminal_history',
    'chat_runs',
    'chat_sub_agent_runs',
    'chat_loops',
    'board_tasks',
    'board_log',
    'groups',
    'chats',
  ];
  db.exec('BEGIN');
  for (const table of tables) {
    const exists = db
      .prepare("select 1 from sqlite_master where type='table' and name=?")
      .get(table);
    if (exists) db.prepare(`delete from ${table}`).run();
  }
  db.prepare("delete from session_meta where key in ('activeId','lastActiveChatIdByApp','lastActiveChatIdByWorkspace')").run();
  db.exec('COMMIT');
  try {
    db.exec("insert into messages_fts(messages_fts) values('rebuild')");
  } catch {
    /* fts table absent in older stores */
  }
  db.exec('VACUUM');
  db.close();
  console.log('[reset-chats] cleared sessions.db');
}

if (fs.existsSync(statePath)) {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.chats = [];
  state.groups = [];
  state.activeId = '';
  state.lastActiveChatIdByApp = {};
  state.lastActiveChatIdByWorkspace = {};
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log('[reset-chats] cleared state.json');
}

console.log('[reset-chats] done — restart Minnow for a clean slate');
