/**
 * Phase A.1 — sessions.db schema: tables, indices, user_version, reopen idempotency.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  closeSessionsDb,
  deleteSessionsDb,
  ensureColumn,
  getSessionsDb,
  openSessionsDbCountForTests,
  SESSIONS_DB_SCHEMA_VERSION,
} from '../../server/config/sessions-db.js';
import { sessionsDbPath } from '../../server/config/sessions-paths.js';
import { rmTestHome, setTestHome } from './test-helpers.js';

const REQUIRED_TABLES = [
  'session_meta',
  'chats',
  'messages',
  'chat_terminal_history',
  'chat_runs',
  'chat_sub_agent_runs',
  'chat_loops',
  'groups',
  'board_tasks',
  'board_log',
  'messages_fts',
];

const REQUIRED_INDEXES = [
  'idx_chats_last_message_at',
  'idx_chats_workspace_last_message',
  'idx_chats_sort_index',
  'idx_chats_group_id',
  'idx_chats_board_task_id',
  'idx_messages_chat_seq',
  'idx_board_tasks_worktree',
  'idx_board_tasks_chat_id',
  'idx_board_log_group_seq',
  'idx_chat_loops_due',
];

describe('sessions-db schema', () => {
  let homeDir;
  let savedHome;

  before(() => {
    savedHome = process.env.MINNOW_HOME;
    homeDir = setTestHome(process.env, `minnow-sessions-db-schema-${Date.now()}`);
    fs.mkdirSync(path.join(homeDir, 'sessions'), { recursive: true });
  });

  after(() => {
    // Always close before rm — Windows cannot delete open SQLite files.
    closeSessionsDb();
    deleteSessionsDb();
    if (savedHome === undefined) {
      delete process.env.MINNOW_HOME;
    } else {
      process.env.MINNOW_HOME = savedHome;
    }
    return rmTestHome(homeDir);
  });

  test('creates real on-disk DB with required tables, indices, and user_version', () => {
    const db = getSessionsDb();
    assert.equal(db.pragma('user_version', { simple: true }), SESSIONS_DB_SCHEMA_VERSION);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);

    // FTS5 virtual tables appear as type='table' in sqlite_master (same as email store).
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      .map((row) => row.name);
    for (const name of REQUIRED_TABLES) {
      assert.ok(tables.includes(name), `missing table ${name}`);
    }

    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
      .all()
      .map((row) => row.name);
    for (const name of REQUIRED_INDEXES) {
      assert.ok(indexes.includes(name), `missing index ${name}`);
    }

    assert.ok(fs.existsSync(sessionsDbPath()), 'sessions.db must be a real file (never :memory:)');
    assert.notEqual(sessionsDbPath().includes(':memory:'), true);
  });

  test('reopen is idempotent and shares one cached handle', () => {
    const first = getSessionsDb();
    const second = getSessionsDb();
    assert.equal(first, second);
    assert.equal(openSessionsDbCountForTests(), 1);

    closeSessionsDb();
    assert.equal(openSessionsDbCountForTests(), 0);

    const reopened = getSessionsDb();
    assert.equal(reopened.pragma('user_version', { simple: true }), SESSIONS_DB_SCHEMA_VERSION);
    const chatCols = reopened.prepare('PRAGMA table_info(chats)').all();
    assert.ok(chatCols.some((col) => col.name === 'history_digest'));
  });

  test('ensureColumn is additive and a no-op on second open', () => {
    const db = getSessionsDb();
    const beforeVersion = db.pragma('user_version', { simple: true });

    const added = ensureColumn(db, 'chats', 'a1_test_extra', "TEXT NOT NULL DEFAULT ''");
    assert.equal(added, true);
    const again = ensureColumn(db, 'chats', 'a1_test_extra', "TEXT NOT NULL DEFAULT ''");
    assert.equal(again, false);

    assert.equal(db.pragma('user_version', { simple: true }), beforeVersion);

    closeSessionsDb();
    const reopened = getSessionsDb();
    const cols = reopened.prepare('PRAGMA table_info(chats)').all();
    assert.ok(cols.some((col) => col.name === 'a1_test_extra'));
    // Second open must not bump user_version for ensureColumn work.
    assert.equal(reopened.pragma('user_version', { simple: true }), SESSIONS_DB_SCHEMA_VERSION);
    const noop = ensureColumn(reopened, 'chats', 'a1_test_extra', "TEXT NOT NULL DEFAULT ''");
    assert.equal(noop, false);
  });
});
