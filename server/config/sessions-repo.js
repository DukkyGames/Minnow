/**
 * Whole-blob + narrow sessions repository over sessions.db (Phase A.2 cutover).
 *
 * HTTP GET/PUT still exchange the full SessionState blob; this module is the
 * SQLite-backed read/write path. Narrow helpers are ready for A.3 consumers.
 *
 * CRITICAL: whole-blob writes ignore chat.terminalHistory (server-owned).
 * Only {@link appendTerminalRun} mutates terminal rows.
 */

import path from 'node:path';
import { defaultSessionStateJson } from './home.js';
import {
  getSessionsDb,
  readSessionMeta,
  writeSessionMeta,
} from './sessions-db.js';
import {
  hashPayload,
  insertBoardLogRow,
  messageTextContent,
  trimBoardLog,
  upsertBoardTaskRow,
  upsertChatLoopRow,
  upsertChatRow,
  upsertChatRunRow,
  upsertGroupRow,
  upsertMessageRow,
  upsertSubAgentRunRow,
  upsertTerminalHistoryRow,
} from './sessions-import.js';
import {
  flushSessionsJsonMirror,
  markSessionsJsonMirrorDirty,
  registerSessionsJsonMirrorSource,
} from './sessions-json-mirror.js';
import {
  migrateChatRowV5ToV6,
  normalizeChatRow,
  normalizeGroupRow,
  normalizeSessionScalars,
  normalizeWorkspacePath,
  SESSION_SCHEMA_VERSION,
  validateSessionState,
} from './validators.js';

/** Cap matches server/terminal-runner.js MAX_TERMINAL_HISTORY. */
const MAX_TERMINAL_HISTORY = 50;

/** @type {WeakMap<import('better-sqlite3').Database, Record<string, import('better-sqlite3').Statement>>} */
const readStmtsByDb = new WeakMap();

/**
 * Eleven hoisted SELECT statements — one .all() each, no N+1 per chat/group.
 * @param {import('better-sqlite3').Database} db
 */
function getReadStmts(db) {
  let stmts = readStmtsByDb.get(db);
  if (stmts) return stmts;
  stmts = {
    // 1
    chats: db.prepare('SELECT * FROM chats ORDER BY sort_index ASC, id ASC'),
    // 2
    messages: db.prepare(
      'SELECT chat_id, seq, payload_json FROM messages ORDER BY chat_id ASC, seq ASC',
    ),
    // 3
    terminal: db.prepare(
      'SELECT * FROM chat_terminal_history ORDER BY chat_id ASC, seq ASC',
    ),
    // 4
    runs: db.prepare(
      'SELECT chat_id, run_id, payload_json FROM chat_runs ORDER BY chat_id ASC, run_id ASC',
    ),
    // 5
    subAgentRuns: db.prepare(
      'SELECT chat_id, run_id, payload_json FROM chat_sub_agent_runs ORDER BY chat_id ASC, run_id ASC',
    ),
    // 6
    loops: db.prepare(
      'SELECT chat_id, loop_id, payload_json FROM chat_loops ORDER BY chat_id ASC, loop_id ASC',
    ),
    // 7
    groups: db.prepare('SELECT * FROM groups ORDER BY sort_order ASC, id ASC'),
    // 8
    boardTasks: db.prepare(
      'SELECT group_id, task_id, payload_json FROM board_tasks ORDER BY group_id ASC, task_id ASC',
    ),
    // 9
    boardLog: db.prepare(
      'SELECT * FROM board_log ORDER BY group_id ASC, seq ASC',
    ),
    // 10
    sessionMeta: db.prepare('SELECT key, value FROM session_meta'),
    // 11 — chat id list used by narrow helpers / existence checks without scanning children
    chatIds: db.prepare('SELECT id FROM chats ORDER BY sort_index ASC, id ASC'),
  };
  readStmtsByDb.set(db, stmts);
  return stmts;
}

/** Parse JSON text with a fallback. */
function parseJson(raw, fallback) {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Bucket rows by a string key into Map<string, T[]>.
 * @template T
 * @param {T[]} rows
 * @param {(row: T) => string} keyFn
 */
function bucketBy(rows, keyFn) {
  /** @type {Map<string, T[]>} */
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

/** Map a terminal_history row to a TerminalRunRecord plain object. */
function terminalRowToRecord(row) {
  /** @type {Record<string, unknown>} */
  const record = {
    id: typeof row.id === 'string' ? row.id : '',
    command: typeof row.command === 'string' ? row.command : '',
    cwd: typeof row.cwd === 'string' ? row.cwd : '',
    source: row.source === 'user' ? 'user' : 'agent',
    startedAt: typeof row.started_at === 'number' ? row.started_at : 0,
    finishedAt: typeof row.finished_at === 'number' ? row.finished_at : 0,
    timedOut: row.timed_out === 1,
    logPath: typeof row.log_path === 'string' ? row.log_path : '',
  };
  if (typeof row.tool_call_id === 'string' && row.tool_call_id) {
    record.toolCallId = row.tool_call_id;
  }
  if (typeof row.exit_code === 'number') {
    record.exitCode = row.exit_code;
  }
  return record;
}

/** Map a board_log row to a board log event. */
function boardLogRowToEvent(row) {
  const detail = parseJson(row.detail_json, {});
  /** @type {Record<string, unknown>} */
  const event = {
    id: typeof row.event_id === 'string' ? row.event_id : '',
    ts: typeof row.ts === 'number' ? row.ts : 0,
    type: typeof row.type === 'string' ? row.type : '',
    level: typeof row.level === 'string' ? row.level : 'info',
    message: typeof row.message === 'string' ? row.message : '',
  };
  if (typeof row.task_id === 'string' && row.task_id) {
    event.taskId = row.task_id;
  }
  if (detail && typeof detail === 'object' && Object.keys(detail).length > 0) {
    event.detail = detail;
  }
  return event;
}

/**
 * Reconstruct one Chat from hot columns + meta_json + child payloads.
 * @param {Record<string, any>} row
 * @param {{
 *   messages: unknown[],
 *   terminalHistory: Record<string, unknown>[],
 *   runs: unknown[],
 *   subAgentRuns: unknown[],
 *   activeLoops: unknown[],
 * }} children
 */
function stitchChat(row, children) {
  const meta = parseJson(row.meta_json, {});
  /** @type {Record<string, unknown>} */
  const chat = {
    ...(meta && typeof meta === 'object' ? meta : {}),
    id: row.id,
    name: row.name ?? '',
    history: children.messages,
    updatedAt: typeof row.updated_at === 'number' ? row.updated_at : 0,
    lastMessageAt: typeof row.last_message_at === 'number' ? row.last_message_at : 0,
  };

  if (row.kind) chat.kind = row.kind;
  if (row.app_scope) chat.appScope = row.app_scope;
  if (row.expert_id) chat.expertId = row.expert_id;
  if (row.workspace_path) chat.workspacePath = row.workspace_path;
  else chat.workspacePath = '';
  if (row.provider_id) chat.providerId = row.provider_id;
  chat.modelId = typeof row.model_id === 'string' ? row.model_id : '';
  if (row.mode_id) chat.modeId = row.mode_id;
  if (row.group_id) chat.groupId = row.group_id;
  if (row.board_group_id) chat.boardGroupId = row.board_group_id;
  if (row.board_task_id) chat.boardTaskId = row.board_task_id;
  if (row.worktree_root) chat.worktreeRoot = row.worktree_root;
  if (row.git_branch) chat.gitBranch = row.git_branch;
  if (row.unread === 1) chat.unread = true;
  if (row.turn_error === 1) chat.turnError = true;
  if (typeof row.last_assistant_at === 'number' && row.last_assistant_at > 0) {
    chat.lastAssistantAt = row.last_assistant_at;
  }

  if (children.terminalHistory.length) {
    chat.terminalHistory = children.terminalHistory;
  }
  if (children.runs.length) chat.runs = children.runs;
  if (children.subAgentRuns.length) chat.subAgentRuns = children.subAgentRuns;
  if (children.activeLoops.length) chat.activeLoops = children.activeLoops;

  return chat;
}

/**
 * Reconstruct one ChatGroup with orchestrateBoard tasks/log stitched back.
 * @param {Record<string, any>} row
 * @param {unknown[]} tasks
 * @param {Record<string, unknown>[]} log
 */
function stitchGroup(row, tasks, log) {
  const payload = parseJson(row.payload_json, {});
  const boardState = parseJson(row.board_state_json, {});
  /** @type {Record<string, unknown>} */
  const group = {
    ...(payload && typeof payload === 'object' ? payload : {}),
    id: row.id,
    name: row.name ?? '',
    workspacePath: row.workspace_path ?? '',
    collapsed: row.collapsed === 1,
    order: typeof row.sort_order === 'number' ? row.sort_order : 0,
    createdAt: typeof row.created_at === 'number' ? row.created_at : 0,
  };
  if (row.orchestrate_plan_path) {
    group.orchestratePlanPath = row.orchestrate_plan_path;
  }
  if (row.view_mode) group.viewMode = row.view_mode;
  if (row.planner_chat_id) group.plannerChatId = row.planner_chat_id;

  const hasBoard =
    (boardState && typeof boardState === 'object' && Object.keys(boardState).length > 0) ||
    tasks.length > 0 ||
    log.length > 0;
  if (hasBoard) {
    group.orchestrateBoard = {
      ...(boardState && typeof boardState === 'object' ? boardState : {}),
      tasks,
      log,
    };
  }
  return group;
}

/**
 * Read the full SessionState from SQLite (eleven hoisted .all() queries).
 * Returns the default blob when the DB has no chats yet.
 */
export function readWholeSessionState() {
  const db = getSessionsDb();
  const stmts = getReadStmts(db);

  const chatRows = stmts.chats.all();
  if (!chatRows.length) {
    return defaultSessionStateJson();
  }

  const messageRows = stmts.messages.all();
  const terminalRows = stmts.terminal.all();
  const runRows = stmts.runs.all();
  const subAgentRows = stmts.subAgentRuns.all();
  const loopRows = stmts.loops.all();
  const groupRows = stmts.groups.all();
  const boardTaskRows = stmts.boardTasks.all();
  const boardLogRows = stmts.boardLog.all();
  // session_meta is also loaded via the hoisted statement (status / diagnostics);
  // scalars below use readSessionMeta for typed JSON parsing.
  void stmts.sessionMeta.all();

  const messagesByChat = bucketBy(messageRows, (r) => r.chat_id);
  const terminalByChat = bucketBy(terminalRows, (r) => r.chat_id);
  const runsByChat = bucketBy(runRows, (r) => r.chat_id);
  const subAgentsByChat = bucketBy(subAgentRows, (r) => r.chat_id);
  const loopsByChat = bucketBy(loopRows, (r) => r.chat_id);
  const tasksByGroup = bucketBy(boardTaskRows, (r) => r.group_id);
  const logByGroup = bucketBy(boardLogRows, (r) => r.group_id);

  const chats = chatRows.map((row) => {
    const messages = (messagesByChat.get(row.id) ?? []).map((m) =>
      parseJson(m.payload_json, null),
    ).filter((m) => m && typeof m === 'object');
    const terminalHistory = (terminalByChat.get(row.id) ?? []).map(terminalRowToRecord);
    const runs = (runsByChat.get(row.id) ?? []).map((r) => parseJson(r.payload_json, null)).filter(
      (r) => r && typeof r === 'object',
    );
    const subAgentRuns = (subAgentsByChat.get(row.id) ?? [])
      .map((r) => parseJson(r.payload_json, null))
      .filter((r) => r && typeof r === 'object');
    const activeLoops = (loopsByChat.get(row.id) ?? [])
      .map((r) => parseJson(r.payload_json, null))
      .filter((r) => r && typeof r === 'object');
    return stitchChat(row, {
      messages,
      terminalHistory,
      runs,
      subAgentRuns,
      activeLoops,
    });
  });

  const groups = groupRows.map((row) => {
    const tasks = (tasksByGroup.get(row.id) ?? [])
      .map((t) => parseJson(t.payload_json, null))
      .filter((t) => t && typeof t === 'object');
    const log = (logByGroup.get(row.id) ?? []).map(boardLogRowToEvent);
    return stitchGroup(row, tasks, log);
  });

  /** @type {Record<string, unknown>} */
  const raw = {
    version: readSessionMeta(db, 'schemaVersion') ?? 6,
    activeId: readSessionMeta(db, 'activeId') ?? '',
    sidebarCollapsed: !!readSessionMeta(db, 'sidebarCollapsed'),
    lastActiveChatIdByWorkspace: readSessionMeta(db, 'lastActiveChatIdByWorkspace') ?? {},
    lastActiveChatIdByApp: readSessionMeta(db, 'lastActiveChatIdByApp') ?? {},
    groups,
    chats,
  };

  const sidebarWidth = readSessionMeta(db, 'sidebarWidth');
  if (typeof sidebarWidth === 'number') raw.sidebarWidth = sidebarWidth;
  const activeBoardGroupId = readSessionMeta(db, 'activeBoardGroupId');
  if (typeof activeBoardGroupId === 'string' && activeBoardGroupId) {
    raw.activeBoardGroupId = activeBoardGroupId;
  }
  const codeChangeTotalsByWorkspace = readSessionMeta(db, 'codeChangeTotalsByWorkspace');
  if (codeChangeTotalsByWorkspace && typeof codeChangeTotalsByWorkspace === 'object') {
    raw.codeChangeTotalsByWorkspace = codeChangeTotalsByWorkspace;
  }

  // Normalize through the same validator the PUT path uses so GET===PUT shapes match.
  return validateSessionState(raw);
}

// Register mirror source once at module load (reads live DB state).
registerSessionsJsonMirrorSource(() => readWholeSessionState());

/**
 * Tail-diff sync for a chat's message rows.
 * (1) length + history_digest match → skip
 * (2) else find first differing seq k; DELETE seq>=k; insert tail
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} chatId
 * @param {Record<string, unknown>[]} history
 * @returns {{ messageCount: number, lastMessagePreview: string, historyDigest: string }}
 */
export function syncMessages(db, chatId, history) {
  const messages = Array.isArray(history) ? history : [];
  const hashes = messages.map((message) => hashPayload(JSON.stringify(message)));
  const historyDigest = hashPayload(hashes.join('\n'));
  const last = messages.length ? messages[messages.length - 1] : null;
  const lastMessagePreview = last ? messageTextContent(last).slice(0, 240) : '';
  const derived = {
    messageCount: messages.length,
    lastMessagePreview,
    historyDigest,
  };

  const chatRow = db
    .prepare('SELECT message_count, history_digest FROM chats WHERE id = ?')
    .get(chatId);
  if (
    chatRow &&
    chatRow.message_count === messages.length &&
    chatRow.history_digest === historyDigest
  ) {
    return derived;
  }

  const existing = db
    .prepare('SELECT seq, row_hash FROM messages WHERE chat_id = ? ORDER BY seq ASC')
    .all(chatId);

  let k = 0;
  const limit = Math.min(existing.length, messages.length);
  while (k < limit && existing[k].row_hash === hashes[k]) {
    k += 1;
  }

  // Truncation or any mutation at/after k — drop the suffix then rewrite the tail.
  if (k < existing.length) {
    db.prepare('DELETE FROM messages WHERE chat_id = ? AND seq >= ?').run(chatId, k);
    db.prepare('DELETE FROM messages_fts WHERE chat_id = ? AND seq >= ?').run(chatId, k);
  } else if (messages.length < existing.length) {
    // Prefix identical but history shortened (should be covered above; belt-and-suspenders).
    db.prepare('DELETE FROM messages WHERE chat_id = ? AND seq >= ?').run(
      chatId,
      messages.length,
    );
    db.prepare('DELETE FROM messages_fts WHERE chat_id = ? AND seq >= ?').run(
      chatId,
      messages.length,
    );
  }

  for (let seq = k; seq < messages.length; seq += 1) {
    upsertMessageRow(db, chatId, seq, messages[seq]);
  }

  return derived;
}

/**
 * Sync runs keyed by run_id — upsert blob rows, delete missing.
 * @param {import('better-sqlite3').Database} db
 * @param {string} chatId
 * @param {Record<string, any>[]} runs
 */
function syncChatRuns(db, chatId, runs) {
  const list = Array.isArray(runs) ? runs : [];
  const keep = [];
  for (const run of list) {
    const runId = typeof run?.runId === 'string' ? run.runId : '';
    if (!runId) continue;
    keep.push(runId);
    upsertChatRunRow(db, chatId, run);
  }
  if (keep.length === 0) {
    db.prepare('DELETE FROM chat_runs WHERE chat_id = ?').run(chatId);
    return;
  }
  const placeholders = keep.map(() => '?').join(', ');
  db.prepare(
    `DELETE FROM chat_runs WHERE chat_id = ? AND run_id NOT IN (${placeholders})`,
  ).run(chatId, ...keep);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} chatId
 * @param {Record<string, any>[]} runs
 */
function syncSubAgentRuns(db, chatId, runs) {
  const list = Array.isArray(runs) ? runs : [];
  const keep = [];
  for (const run of list) {
    const runId = typeof run?.runId === 'string' ? run.runId : '';
    if (!runId) continue;
    keep.push(runId);
    upsertSubAgentRunRow(db, chatId, run);
  }
  if (keep.length === 0) {
    db.prepare('DELETE FROM chat_sub_agent_runs WHERE chat_id = ?').run(chatId);
    return;
  }
  const placeholders = keep.map(() => '?').join(', ');
  db.prepare(
    `DELETE FROM chat_sub_agent_runs WHERE chat_id = ? AND run_id NOT IN (${placeholders})`,
  ).run(chatId, ...keep);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} chatId
 * @param {Record<string, any>[]} loops
 */
function syncChatLoops(db, chatId, loops) {
  const list = Array.isArray(loops) ? loops : [];
  const keep = [];
  for (const loop of list) {
    const loopId = typeof loop?.id === 'number' ? loop.id : Number(loop?.id);
    if (!Number.isFinite(loopId)) continue;
    keep.push(loopId);
    upsertChatLoopRow(db, chatId, loop);
  }
  if (keep.length === 0) {
    db.prepare('DELETE FROM chat_loops WHERE chat_id = ?').run(chatId);
    return;
  }
  const placeholders = keep.map(() => '?').join(', ');
  db.prepare(
    `DELETE FROM chat_loops WHERE chat_id = ? AND loop_id NOT IN (${placeholders})`,
  ).run(chatId, ...keep);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} groupId
 * @param {Record<string, any>[]} tasks
 */
function syncBoardTasks(db, groupId, tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const keep = [];
  for (const task of list) {
    const taskId = typeof task?.id === 'string' ? task.id : '';
    if (!taskId) continue;
    keep.push(taskId);
    upsertBoardTaskRow(db, groupId, task);
  }
  if (keep.length === 0) {
    db.prepare('DELETE FROM board_tasks WHERE group_id = ?').run(groupId);
    return;
  }
  const placeholders = keep.map(() => '?').join(', ');
  db.prepare(
    `DELETE FROM board_tasks WHERE group_id = ? AND task_id NOT IN (${placeholders})`,
  ).run(groupId, ...keep);
}

/**
 * Wholesale replace board log for a group (blob is authoritative for log events).
 * @param {import('better-sqlite3').Database} db
 * @param {string} groupId
 * @param {Record<string, any>[]} log
 */
function syncBoardLog(db, groupId, log) {
  db.prepare('DELETE FROM board_log WHERE group_id = ?').run(groupId);
  const list = Array.isArray(log) ? log : [];
  for (const event of list) {
    insertBoardLogRow(db, groupId, event);
  }
  trimBoardLog(db, groupId);
}

/** Write session_meta scalars from a validated SessionState. */
function writeScalars(db, state) {
  writeSessionMeta(db, 'schemaVersion', state.version ?? 6);
  writeSessionMeta(db, 'activeId', state.activeId ?? '');
  writeSessionMeta(db, 'sidebarCollapsed', !!state.sidebarCollapsed);
  if (typeof state.sidebarWidth === 'number') {
    writeSessionMeta(db, 'sidebarWidth', state.sidebarWidth);
  } else {
    writeSessionMeta(db, 'sidebarWidth', null);
  }
  if (typeof state.activeBoardGroupId === 'string') {
    writeSessionMeta(db, 'activeBoardGroupId', state.activeBoardGroupId);
  } else {
    writeSessionMeta(db, 'activeBoardGroupId', null);
  }
  writeSessionMeta(db, 'lastActiveChatIdByWorkspace', state.lastActiveChatIdByWorkspace ?? {});
  writeSessionMeta(db, 'lastActiveChatIdByApp', state.lastActiveChatIdByApp ?? {});
  if (state.codeChangeTotalsByWorkspace) {
    writeSessionMeta(db, 'codeChangeTotalsByWorkspace', state.codeChangeTotalsByWorkspace);
  } else {
    writeSessionMeta(db, 'codeChangeTotalsByWorkspace', null);
  }
}

/**
 * Wholesale replace SessionState in ONE transaction.
 * Does NOT apply chat.terminalHistory from the client blob (server-owned).
 *
 * @param {Record<string, any>} state  Already validated SessionState
 */
export function writeWholeSessionState(state) {
  const db = getSessionsDb();
  const chats = Array.isArray(state.chats) ? state.chats : [];
  const groups = Array.isArray(state.groups) ? state.groups : [];

  const tx = db.transaction(() => {
    writeScalars(db, state);

    const groupIds = [];
    for (const group of groups) {
      if (!group?.id) continue;
      groupIds.push(String(group.id));
      upsertGroupRow(db, group);
      const board = group.orchestrateBoard;
      syncBoardTasks(db, group.id, Array.isArray(board?.tasks) ? board.tasks : []);
      syncBoardLog(db, group.id, Array.isArray(board?.log) ? board.log : []);
    }
    if (groupIds.length === 0) {
      db.prepare('DELETE FROM groups').run();
    } else {
      const placeholders = groupIds.map(() => '?').join(', ');
      db.prepare(`DELETE FROM groups WHERE id NOT IN (${placeholders})`).run(...groupIds);
    }

    const chatIds = [];
    chats.forEach((chat, sortIndex) => {
      if (!chat?.id) return;
      const chatId = String(chat.id);
      chatIds.push(chatId);
      const history = Array.isArray(chat.history) ? chat.history : [];

      // Parent row first (FK), with a provisional digest; syncMessages refreshes it.
      upsertChatRow(db, chat, sortIndex, {
        messageCount: history.length,
        lastMessagePreview: '',
        historyDigest: '',
      });

      const derived = syncMessages(db, chatId, history);
      upsertChatRow(db, chat, sortIndex, derived);

      syncChatRuns(db, chatId, Array.isArray(chat.runs) ? chat.runs : []);
      syncSubAgentRuns(db, chatId, Array.isArray(chat.subAgentRuns) ? chat.subAgentRuns : []);
      syncChatLoops(db, chatId, Array.isArray(chat.activeLoops) ? chat.activeLoops : []);
      // Intentionally skip chat.terminalHistory — preserve existing terminal rows.
    });

    if (chatIds.length === 0) {
      db.prepare('DELETE FROM chats').run();
    } else {
      const placeholders = chatIds.map(() => '?').join(', ');
      db.prepare(`DELETE FROM chats WHERE id NOT IN (${placeholders})`).run(...chatIds);
    }
  });
  tx();
  markSessionsJsonMirrorDirty();
}

/**
 * Append one TerminalRunRecord for a chat (server-owned write path).
 * @param {string} chatId
 * @param {Record<string, any>} record
 */
export function appendTerminalRun(chatId, record) {
  const trimmed = typeof chatId === 'string' ? chatId.trim() : '';
  if (!trimmed || !record || typeof record !== 'object') return;

  const db = getSessionsDb();
  const tx = db.transaction(() => {
    const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(trimmed);
    if (!chat) return;

    const countRow = db
      .prepare('SELECT COUNT(*) AS n FROM chat_terminal_history WHERE chat_id = ?')
      .get(trimmed);
    let count = countRow?.n ?? 0;
    while (count >= MAX_TERMINAL_HISTORY) {
      db.prepare(
        `DELETE FROM chat_terminal_history
         WHERE chat_id = ? AND seq = (
           SELECT MIN(seq) FROM chat_terminal_history WHERE chat_id = ?
         )`,
      ).run(trimmed, trimmed);
      count -= 1;
    }

    const maxRow = db
      .prepare(
        'SELECT COALESCE(MAX(seq), -1) AS m FROM chat_terminal_history WHERE chat_id = ?',
      )
      .get(trimmed);
    const nextSeq = (maxRow?.m ?? -1) + 1;
    upsertTerminalHistoryRow(db, trimmed, nextSeq, record);
    db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(Date.now(), trimmed);
  });
  tx();
  markSessionsJsonMirrorDirty();
}

/**
 * Read terminal history for one chat (ordered by seq).
 * @param {string} chatId
 * @returns {Record<string, unknown>[]}
 */
export function readTerminalHistory(chatId) {
  const trimmed = typeof chatId === 'string' ? chatId.trim() : '';
  if (!trimmed) return [];
  const db = getSessionsDb();
  const rows = db
    .prepare(
      'SELECT * FROM chat_terminal_history WHERE chat_id = ? ORDER BY seq ASC',
    )
    .all(trimmed);
  return rows.map(terminalRowToRecord);
}

/**
 * Resolve worktree root + board group id for a chat (A.3 consumer helper).
 * @param {string} chatId
 * @returns {{ worktreeRoot: string | undefined, groupId: string | undefined }}
 */
export function resolveChatWorktreeContext(chatId) {
  const trimmed = typeof chatId === 'string' ? chatId.trim() : '';
  if (!trimmed) return { worktreeRoot: undefined, groupId: undefined };

  const db = getSessionsDb();
  const chat = db
    .prepare(
      `SELECT worktree_root, board_group_id, board_task_id
       FROM chats WHERE id = ?`,
    )
    .get(trimmed);
  if (!chat) return { worktreeRoot: undefined, groupId: undefined };

  const groupId = chat.board_group_id?.trim() || undefined;
  const direct = chat.worktree_root?.trim();
  if (direct) return { worktreeRoot: direct, groupId };

  const taskId = chat.board_task_id?.trim();
  const gId = chat.board_group_id?.trim();
  if (!taskId || !gId) return { worktreeRoot: undefined, groupId };

  const task = db
    .prepare(
      `SELECT worktree_path FROM board_tasks
       WHERE group_id = ? AND task_id = ?`,
    )
    .get(gId, taskId);
  return {
    worktreeRoot: task?.worktree_path?.trim() || undefined,
    groupId,
  };
}

/**
 * Resolve board-task ports for a chat and/or worktree cwd.
 * @param {{ chatId?: string, cwd?: string }} params
 * @returns {{ devPort: number, apiPort: number } | undefined}
 */
export function resolveBoardTaskPorts({ chatId, cwd } = {}) {
  const db = getSessionsDb();
  const API_PORT_OFFSET = 100;
  const trimmedChatId = typeof chatId === 'string' ? chatId.trim() : '';
  let resolvedCwd = typeof cwd === 'string' && cwd.trim() ? path.resolve(cwd.trim()) : '';

  if (trimmedChatId) {
    const ctx = resolveChatWorktreeContext(trimmedChatId);
    if (ctx.worktreeRoot) resolvedCwd = path.resolve(ctx.worktreeRoot);
  }
  if (!resolvedCwd) return undefined;

  const normalize = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
  const target = normalize(resolvedCwd);

  if (trimmedChatId) {
    const chat = db
      .prepare('SELECT board_group_id, board_task_id FROM chats WHERE id = ?')
      .get(trimmedChatId);
    const taskId = chat?.board_task_id?.trim();
    const groupId = chat?.board_group_id?.trim();
    if (taskId && groupId) {
      const task = db
        .prepare(
          `SELECT worktree_path, dev_port, api_port
           FROM board_tasks WHERE group_id = ? AND task_id = ?`,
        )
        .get(groupId, taskId);
      const wt = task?.worktree_path?.trim();
      if (
        task &&
        wt &&
        normalize(wt) === target &&
        typeof task.dev_port === 'number' &&
        Number.isFinite(task.dev_port) &&
        task.dev_port > 0
      ) {
        const apiPort =
          typeof task.api_port === 'number' && Number.isFinite(task.api_port) && task.api_port > 0
            ? task.api_port
            : task.dev_port + API_PORT_OFFSET;
        return { devPort: task.dev_port, apiPort };
      }
    }
  }

  const rows = db
    .prepare(
      `SELECT worktree_path, dev_port, api_port FROM board_tasks
       WHERE worktree_path != '' AND dev_port > 0`,
    )
    .all();
  for (const row of rows) {
    const wt = row.worktree_path?.trim();
    if (!wt || normalize(wt) !== target) continue;
    const apiPort =
      typeof row.api_port === 'number' && Number.isFinite(row.api_port) && row.api_port > 0
        ? row.api_port
        : row.dev_port + API_PORT_OFFSET;
    return { devPort: row.dev_port, apiPort };
  }
  return undefined;
}

/**
 * Active chat's provider/model binding (scheduler / research / brain).
 * @returns {{ chatId: string, providerId: string, modelId: string } | null}
 */
export function readActiveChatModelBinding() {
  const db = getSessionsDb();
  const activeId = readSessionMeta(db, 'activeId');
  if (typeof activeId !== 'string' || !activeId) return null;
  const chat = db
    .prepare('SELECT id, provider_id, model_id FROM chats WHERE id = ?')
    .get(activeId);
  if (!chat) return null;
  return {
    chatId: chat.id,
    providerId: typeof chat.provider_id === 'string' ? chat.provider_id : '',
    modelId: typeof chat.model_id === 'string' ? chat.model_id : '',
  };
}

/** All chat ids in sidebar order. */
export function readAllChatIds() {
  const db = getSessionsDb();
  return getReadStmts(db).chatIds.all().map((row) => row.id);
}

/**
 * Map a `chats` row to a ChatSummary (column fields only — never includes `history`).
 * @param {Record<string, any>} row
 */
function chatRowToSummary(row) {
  /** @type {Record<string, unknown>} */
  const summary = {
    id: typeof row.id === 'string' ? row.id : '',
    name: typeof row.name === 'string' ? row.name : '',
    workspacePath: typeof row.workspace_path === 'string' ? row.workspace_path : '',
    modelId: typeof row.model_id === 'string' ? row.model_id : '',
    updatedAt: typeof row.updated_at === 'number' ? row.updated_at : 0,
    messageCount: typeof row.message_count === 'number' ? row.message_count : 0,
    lastMessagePreview:
      typeof row.last_message_preview === 'string' ? row.last_message_preview : '',
  };
  if (typeof row.sort_index === 'number') summary.sortIndex = row.sort_index;
  if (row.kind) summary.kind = row.kind;
  if (row.app_scope) summary.appScope = row.app_scope;
  if (row.expert_id) summary.expertId = row.expert_id;
  if (row.provider_id) summary.providerId = row.provider_id;
  if (row.mode_id) summary.modeId = row.mode_id;
  if (row.group_id) summary.groupId = row.group_id;
  if (row.board_group_id) summary.boardGroupId = row.board_group_id;
  if (row.board_task_id) summary.boardTaskId = row.board_task_id;
  if (row.worktree_root) summary.worktreeRoot = row.worktree_root;
  if (row.git_branch) summary.gitBranch = row.git_branch;
  if (typeof row.last_message_at === 'number' && row.last_message_at > 0) {
    summary.lastMessageAt = row.last_message_at;
  }
  if (typeof row.last_assistant_at === 'number' && row.last_assistant_at > 0) {
    summary.lastAssistantAt = row.last_assistant_at;
  }
  if (row.unread === 1) summary.unread = true;
  if (row.turn_error === 1) summary.turnError = true;
  if (typeof row.history_digest === 'string' && row.history_digest) {
    summary.historyDigest = row.history_digest;
  }
  return summary;
}

/**
 * List chat summaries (no message bodies) for sidebar / lazy boot.
 * @param {{ workspace?: string }} [filter]  When `workspace` is set, only that path.
 * @returns {Record<string, unknown>[]}
 */
export function readChatSummaries(filter = {}) {
  const db = getSessionsDb();
  const workspaceRaw = typeof filter.workspace === 'string' ? filter.workspace : '';
  const workspace = normalizeWorkspacePath(workspaceRaw);
  const rows = workspace
    ? db
        .prepare(
          'SELECT * FROM chats WHERE workspace_path = ? ORDER BY sort_index ASC, id ASC',
        )
        .all(workspace)
    : getReadStmts(db).chats.all();
  return rows.map(chatRowToSummary);
}

/**
 * Load message payloads for one chat.
 *
 * CRITICAL: Chat consumers that compute absolute indices into `chat.history`
 * (archive `startIndex`/`endIndex`, `TurnSnapshot.historyPrefixHash`,
 * `TurnRunRecord.outputHistoryStart`/`End`) MUST load the ENTIRE history.
 * Never feed a paged slice into those pipelines — it corrupts indices/hashes.
 *
 * `offset` / `limit` exist only for a future virtualized renderer and must
 * never feed anything computing absolute indices.
 *
 * @param {string} chatId
 * @param {{ offset?: number, limit?: number }} [opts]
 * @returns {Record<string, unknown>[]}
 */
export function readChatHistory(chatId, opts = {}) {
  const trimmed = typeof chatId === 'string' ? chatId.trim() : '';
  if (!trimmed) return [];

  const db = getSessionsDb();
  const offset =
    typeof opts.offset === 'number' && Number.isFinite(opts.offset) && opts.offset > 0
      ? Math.floor(opts.offset)
      : 0;
  const limit =
    typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0
      ? Math.floor(opts.limit)
      : null;

  let sql =
    'SELECT payload_json FROM messages WHERE chat_id = ? ORDER BY seq ASC';
  /** @type {unknown[]} */
  const params = [trimmed];
  if (limit != null) {
    sql += ' LIMIT ?';
    params.push(limit);
    if (offset > 0) {
      sql += ' OFFSET ?';
      params.push(offset);
    }
  } else if (offset > 0) {
    // OFFSET without LIMIT is unusual; still honor for the virtualized path.
    sql += ' LIMIT -1 OFFSET ?';
    params.push(offset);
  }

  const rows = db.prepare(sql).all(...params);
  return rows
    .map((row) => parseJson(row.payload_json, null))
    .filter((message) => message && typeof message === 'object');
}

/**
 * Session scalars + groups + chat summaries (no `history` on chats).
 * Used by GET /api/config/sessions/summaries.
 * @param {{ workspace?: string }} [filter]
 */
export function readSessionSummariesState(filter = {}) {
  const db = getSessionsDb();
  const stmts = getReadStmts(db);
  const workspaceRaw = typeof filter.workspace === 'string' ? filter.workspace : '';
  const workspace = normalizeWorkspacePath(workspaceRaw);

  const groupRows = stmts.groups.all();
  const boardTaskRows = stmts.boardTasks.all();
  const boardLogRows = stmts.boardLog.all();
  const tasksByGroup = bucketBy(boardTaskRows, (r) => r.group_id);
  const logByGroup = bucketBy(boardLogRows, (r) => r.group_id);

  let groups = groupRows.map((row) => {
    const tasks = (tasksByGroup.get(row.id) ?? [])
      .map((t) => parseJson(t.payload_json, null))
      .filter((t) => t && typeof t === 'object');
    const log = (logByGroup.get(row.id) ?? []).map(boardLogRowToEvent);
    return stitchGroup(row, tasks, log);
  });
  if (workspace) {
    groups = groups.filter(
      (g) => normalizeWorkspacePath(String(g.workspacePath ?? '')) === workspace,
    );
  }

  /** @type {Record<string, unknown>} */
  const raw = {
    version: readSessionMeta(db, 'schemaVersion') ?? SESSION_SCHEMA_VERSION,
    activeId: readSessionMeta(db, 'activeId') ?? '',
    sidebarCollapsed: !!readSessionMeta(db, 'sidebarCollapsed'),
    lastActiveChatIdByWorkspace: readSessionMeta(db, 'lastActiveChatIdByWorkspace') ?? {},
    lastActiveChatIdByApp: readSessionMeta(db, 'lastActiveChatIdByApp') ?? {},
    groups,
    chats: readChatSummaries(filter),
  };

  const sidebarWidth = readSessionMeta(db, 'sidebarWidth');
  if (typeof sidebarWidth === 'number') raw.sidebarWidth = sidebarWidth;
  const activeBoardGroupId = readSessionMeta(db, 'activeBoardGroupId');
  if (typeof activeBoardGroupId === 'string' && activeBoardGroupId) {
    raw.activeBoardGroupId = activeBoardGroupId;
  }
  const codeChangeTotalsByWorkspace = readSessionMeta(db, 'codeChangeTotalsByWorkspace');
  if (codeChangeTotalsByWorkspace && typeof codeChangeTotalsByWorkspace === 'object') {
    raw.codeChangeTotalsByWorkspace = codeChangeTotalsByWorkspace;
  }

  return raw;
}

/** Export the current SessionState (POST /api/config/sessions/export-json). */
export function exportSessionStateToJson() {
  return readWholeSessionState();
}

/**
 * Apply a partial SessionState delta in one transaction (Phase B.0).
 * Absent keys mean unchanged; deletes are explicit id lists.
 * Does NOT apply chat.terminalHistory (server-owned — same rule as whole-blob PUT).
 *
 * @param {unknown} delta
 * @returns {{ ok: true, applied: {
 *   chats: number, deletedChats: number, groups: number, deletedGroups: number, scalars: boolean
 * } }}
 */
export function patchSessionState(delta) {
  if (!delta || typeof delta !== 'object') {
    const err = new Error('Invalid session patch');
    /** @type {Error & { statusCode?: number }} */ (err).statusCode = 400;
    throw err;
  }

  const body = /** @type {Record<string, unknown>} */ (delta);
  const baseVersion = body.baseVersion;
  if (
    baseVersion !== undefined &&
    baseVersion !== 1 &&
    baseVersion !== 2 &&
    baseVersion !== 3 &&
    baseVersion !== 4 &&
    baseVersion !== 5 &&
    baseVersion !== 6
  ) {
    const err = new Error('Invalid session baseVersion');
    /** @type {Error & { statusCode?: number }} */ (err).statusCode = 400;
    throw err;
  }
  // Older baseVersion is accepted; rows are normalized to SESSION_SCHEMA_VERSION.
  void SESSION_SCHEMA_VERSION;

  const applied = {
    chats: 0,
    deletedChats: 0,
    groups: 0,
    deletedGroups: 0,
    scalars: false,
  };

  const db = getSessionsDb();
  const tx = db.transaction(() => {
    // Explicit deletes first (CASCADE clears child rows).
    if (Array.isArray(body.deleteChatIds)) {
      const delChat = db.prepare('DELETE FROM chats WHERE id = ?');
      for (const id of body.deleteChatIds) {
        if (typeof id !== 'string' || !id.trim()) continue;
        const result = delChat.run(id.trim());
        if (result.changes > 0) applied.deletedChats += 1;
      }
    }

    if (Array.isArray(body.deleteGroupIds)) {
      const delGroup = db.prepare('DELETE FROM groups WHERE id = ?');
      for (const id of body.deleteGroupIds) {
        if (typeof id !== 'string' || !id.trim()) continue;
        const result = delGroup.run(id.trim());
        if (result.changes > 0) applied.deletedGroups += 1;
      }
    }

    // Upsert full dirty chat objects (unknown ids insert at end of sidebar order).
    if (Array.isArray(body.chats)) {
      for (const raw of body.chats) {
        if (!raw || typeof raw !== 'object') continue;
        const chat = normalizeChatRow(raw);
        // PATCH always lands v6 chat rows (strip legacy expertSelection if present).
        migrateChatRowV5ToV6(chat);
        const chatId = String(chat.id);
        const existing = db
          .prepare('SELECT sort_index FROM chats WHERE id = ?')
          .get(chatId);
        let sortIndex;
        if (existing && typeof existing.sort_index === 'number') {
          sortIndex = existing.sort_index;
        } else {
          const maxRow = db
            .prepare('SELECT COALESCE(MAX(sort_index), -1) AS m FROM chats')
            .get();
          sortIndex = (maxRow?.m ?? -1) + 1;
        }

        const history = Array.isArray(chat.history) ? chat.history : [];
        upsertChatRow(db, chat, sortIndex, {
          messageCount: history.length,
          lastMessagePreview: '',
          historyDigest: '',
        });
        const derived = syncMessages(db, chatId, history);
        upsertChatRow(db, chat, sortIndex, derived);
        syncChatRuns(db, chatId, Array.isArray(chat.runs) ? chat.runs : []);
        syncSubAgentRuns(
          db,
          chatId,
          Array.isArray(chat.subAgentRuns) ? chat.subAgentRuns : [],
        );
        syncChatLoops(
          db,
          chatId,
          Array.isArray(chat.activeLoops) ? chat.activeLoops : [],
        );
        // Intentionally skip chat.terminalHistory — preserve existing terminal rows.
        applied.chats += 1;
      }
    }

    // Upsert full dirty group objects.
    if (Array.isArray(body.groups)) {
      for (const raw of body.groups) {
        const group = normalizeGroupRow(raw);
        if (!group?.id) continue;
        upsertGroupRow(db, group);
        const board = group.orchestrateBoard;
        syncBoardTasks(db, group.id, Array.isArray(board?.tasks) ? board.tasks : []);
        syncBoardLog(db, group.id, Array.isArray(board?.log) ? board.log : []);
        applied.groups += 1;
      }
    }

    // Partial scalars — only keys present on body.scalars are written.
    if (body.scalars && typeof body.scalars === 'object') {
      const scalars = normalizeSessionScalars(body.scalars, { mode: 'partial' });
      applyPartialScalars(db, scalars);
      applied.scalars = Object.keys(scalars).length > 0;
    }

    const countRow = db.prepare('SELECT COUNT(*) AS n FROM chats').get();
    if (!countRow?.n) {
      const err = new Error('Session must have at least one chat');
      /** @type {Error & { statusCode?: number }} */ (err).statusCode = 400;
      throw err;
    }

    // Keep activeId pointing at a real chat after deletes.
    const activeId = readSessionMeta(db, 'activeId');
    const activeOk =
      typeof activeId === 'string' &&
      activeId &&
      db.prepare('SELECT id FROM chats WHERE id = ?').get(activeId);
    if (!activeOk) {
      const first = db
        .prepare('SELECT id FROM chats ORDER BY sort_index ASC, id ASC')
        .get();
      if (first?.id) writeSessionMeta(db, 'activeId', first.id);
    }

    // Keep schemaVersion meta aligned with wire version.
    writeSessionMeta(db, 'schemaVersion', SESSION_SCHEMA_VERSION);
  });
  tx();
  markSessionsJsonMirrorDirty();
  return { ok: true, applied };
}

/**
 * Write only the scalar keys present in a partial normalizeSessionScalars result.
 * @param {import('better-sqlite3').Database} db
 * @param {Record<string, unknown>} scalars
 */
function applyPartialScalars(db, scalars) {
  if (Object.prototype.hasOwnProperty.call(scalars, 'version')) {
    writeSessionMeta(db, 'schemaVersion', scalars.version ?? SESSION_SCHEMA_VERSION);
  }
  if (Object.prototype.hasOwnProperty.call(scalars, 'activeId')) {
    writeSessionMeta(db, 'activeId', typeof scalars.activeId === 'string' ? scalars.activeId : '');
  }
  if (Object.prototype.hasOwnProperty.call(scalars, 'sidebarCollapsed')) {
    writeSessionMeta(db, 'sidebarCollapsed', !!scalars.sidebarCollapsed);
  }
  if (Object.prototype.hasOwnProperty.call(scalars, 'sidebarWidth')) {
    writeSessionMeta(
      db,
      'sidebarWidth',
      typeof scalars.sidebarWidth === 'number' ? scalars.sidebarWidth : null,
    );
  }
  if (Object.prototype.hasOwnProperty.call(scalars, 'activeBoardGroupId')) {
    writeSessionMeta(
      db,
      'activeBoardGroupId',
      typeof scalars.activeBoardGroupId === 'string' ? scalars.activeBoardGroupId : null,
    );
  }
  if (Object.prototype.hasOwnProperty.call(scalars, 'lastActiveChatIdByWorkspace')) {
    writeSessionMeta(
      db,
      'lastActiveChatIdByWorkspace',
      scalars.lastActiveChatIdByWorkspace ?? {},
    );
  }
  if (Object.prototype.hasOwnProperty.call(scalars, 'lastActiveChatIdByApp')) {
    writeSessionMeta(db, 'lastActiveChatIdByApp', scalars.lastActiveChatIdByApp ?? {});
  }
  if (Object.prototype.hasOwnProperty.call(scalars, 'codeChangeTotalsByWorkspace')) {
    writeSessionMeta(
      db,
      'codeChangeTotalsByWorkspace',
      scalars.codeChangeTotalsByWorkspace ?? null,
    );
  }
}

/** Whether the process should use the legacy JSON sessions path. */
export function useJsonSessionsStore() {
  return process.env.MINNOW_SESSIONS_STORE === 'json';
}

/** Expose mirror flush for sessions-db closeSessionsDb (and tests). */
export { flushSessionsJsonMirror };
