/**
 * Phase A.1 — JSON → SQLite import: fresh install, kitchen-sink, idempotent reopen, corrupt JSON.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  closeSessionsDb,
  deleteSessionsDb,
  getSessionsDb,
  readSessionMeta,
} from '../../server/config/sessions-db.js';
import { importJsonSessionsIfNeeded } from '../../server/config/sessions-import.js';
import {
  sessionsJsonMigratedPath,
  sessionsJsonPath,
} from '../../server/config/sessions-paths.js';
import { FIXTURES_DIR, rmTestHome, setTestHome } from './test-helpers.js';

const KITCHEN_SINK = path.join(FIXTURES_DIR, 'kitchen-sink-sessions-state.json');

describe('sessions JSON→SQLite import', () => {
  let homeDir;
  let savedHome;

  before(() => {
    savedHome = process.env.MINNOW_HOME;
    homeDir = setTestHome(process.env, `minnow-sessions-import-${Date.now()}`);
  });

  after(() => {
    closeSessionsDb();
    deleteSessionsDb();
    if (savedHome === undefined) {
      delete process.env.MINNOW_HOME;
    } else {
      process.env.MINNOW_HOME = savedHome;
    }
    return rmTestHome(homeDir);
  });

  beforeEach(() => {
    closeSessionsDb();
    deleteSessionsDb();
    const sessionsDir = path.join(homeDir, 'sessions');
    fs.rmSync(sessionsDir, { recursive: true, force: true });
    fs.mkdirSync(sessionsDir, { recursive: true });
  });

  test('no JSON → stamps jsonImportedAt with zero chat/message rows', () => {
    const db = getSessionsDb();
    const importedAt = readSessionMeta(db, 'jsonImportedAt');
    assert.ok(importedAt, 'fresh install must stamp jsonImportedAt');
    assert.equal(readSessionMeta(db, 'jsonImportFailedAt'), null);

    const chats = db.prepare('SELECT COUNT(*) AS n FROM chats').get().n;
    const messages = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
    assert.equal(chats, 0);
    assert.equal(messages, 0);
    assert.equal(fs.existsSync(sessionsJsonPath()), false);
  });

  test('kitchen-sink seed → counts match and state.json renamed to .migrated', () => {
    const raw = fs.readFileSync(KITCHEN_SINK, 'utf8');
    const parsed = JSON.parse(raw);
    fs.writeFileSync(sessionsJsonPath(), raw, 'utf8');

    const db = getSessionsDb();
    assert.ok(readSessionMeta(db, 'jsonImportedAt'));
    assert.equal(readSessionMeta(db, 'jsonImportFailedAt'), null);

    const expectedChats = parsed.chats.length;
    const expectedMessages = parsed.chats.reduce(
      (sum, chat) => sum + (Array.isArray(chat.history) ? chat.history.length : 0),
      0,
    );
    const chatCount = db.prepare('SELECT COUNT(*) AS n FROM chats').get().n;
    const messageCount = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
    assert.equal(chatCount, expectedChats);
    assert.equal(messageCount, expectedMessages);

    // Child tables from the kitchen-sink fixture.
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM groups').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM board_tasks').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM board_log').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_terminal_history').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_runs').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_sub_agent_runs').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_loops').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages_fts').get().n, expectedMessages);

    // Scalars landed in session_meta.
    assert.equal(readSessionMeta(db, 'activeId'), parsed.activeId);
    assert.equal(readSessionMeta(db, 'schemaVersion'), 6);

    // Message payload stored verbatim (tool_calls survive as JSON, not columns).
    const msg = db
      .prepare('SELECT payload_json, has_tool_calls, row_hash FROM messages WHERE seq = 1')
      .get();
    const payload = JSON.parse(msg.payload_json);
    assert.equal(payload.role, 'assistant');
    assert.ok(Array.isArray(payload.tool_calls));
    assert.equal(msg.has_tool_calls, 1);
    assert.ok(msg.row_hash);

    assert.equal(fs.existsSync(sessionsJsonPath()), false);
    assert.ok(fs.existsSync(sessionsJsonMigratedPath()), 'JSON must be renamed, never deleted');
  });

  test('reopen → already_migrated, no double insert', () => {
    fs.copyFileSync(KITCHEN_SINK, sessionsJsonPath());
    const db1 = getSessionsDb();
    const chatsAfterFirst = db1.prepare('SELECT COUNT(*) AS n FROM chats').get().n;
    const messagesAfterFirst = db1.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
    const importedAt = readSessionMeta(db1, 'jsonImportedAt');

    closeSessionsDb();
    // Re-seed JSON would be wrong — file should already be .migrated. Put a decoy state.json
    // back to prove the flag short-circuits even if a new JSON appears.
    fs.writeFileSync(
      sessionsJsonPath(),
      JSON.stringify({
        version: 6,
        activeId: 'should-not-import',
        chats: [{ id: 'should-not-import', name: 'Decoy', history: [{ role: 'user', content: 'x' }] }],
      }),
      'utf8',
    );

    const db2 = getSessionsDb();
    const again = importJsonSessionsIfNeeded(db2);
    assert.equal(again.reason, 'already_migrated');
    assert.equal(again.migrated, false);
    assert.equal(readSessionMeta(db2, 'jsonImportedAt'), importedAt);
    assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM chats').get().n, chatsAfterFirst);
    assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM messages').get().n, messagesAfterFirst);
    assert.equal(
      db2.prepare(`SELECT COUNT(*) AS n FROM chats WHERE id = 'should-not-import'`).get().n,
      0,
    );
  });

  test('corrupt JSON → flag NOT stamped, file NOT renamed, failed meta present', () => {
    fs.writeFileSync(sessionsJsonPath(), '{not-valid-json', 'utf8');

    const db = getSessionsDb();
    assert.equal(readSessionMeta(db, 'jsonImportedAt'), null);
    assert.ok(readSessionMeta(db, 'jsonImportFailedAt'));
    assert.ok(readSessionMeta(db, 'jsonImportFailedMessage'));

    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chats').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0);

    assert.ok(fs.existsSync(sessionsJsonPath()), 'corrupt JSON must remain in place');
    assert.equal(fs.existsSync(sessionsJsonMigratedPath()), false);
  });
});
