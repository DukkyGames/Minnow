/**
 * Phase 2 file-restore path for undo-turn (injected git deps — no module mock).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { streamingChatIds } from '../../src/app-state.ts';
import {
  confirmAndRestoreTurnSnapshot,
  formatSnapshotRestoreConfirm,
  snapshotRestoreConfirmLabels,
  undoLastAgentTurn,
  type UndoGitDeps,
} from '../../src/chat/undo-turn.ts';
import { createRun, finalizeRun } from '../../src/state/runs-store.ts';
import {
  flushScheduledSessionSaveForTests,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import type { Chat, TurnSnapshot } from '../../src/types.ts';

const FIXED_PRE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FIXED_POST = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const FIXED_HEAD = 'cccccccccccccccccccccccccccccccccccccccc';
const FIXED_SAFETY = 'dddddddddddddddddddddddddddddddddddddddd';
const FIXED_MOVED_HEAD = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

let diffFiles: { status: string; path: string }[] = [{ status: 'M', path: 'src/app.ts' }];
let currentHead = FIXED_HEAD;
let restoreCalls: { cwd?: string; sha: string }[] = [];
let restoreShouldFail = false;

function mockGit(): UndoGitDeps {
  return {
    snapshotDiff: async () => ({ ok: true, files: diffFiles }),
    snapshotRestore: async (input) => {
      restoreCalls.push(input);
      if (restoreShouldFail) {
        return { ok: false, error: 'restore boom', safetySha: FIXED_SAFETY };
      }
      return { ok: true, sha: input.sha, safetySha: FIXED_SAFETY };
    },
    log: async () => ({
      ok: true,
      commits: [
        {
          hash: currentHead,
          parents: [],
          subject: 'tip',
          author: 't',
          relativeTime: 'now',
          refs: [],
        },
      ],
    }),
  };
}

function baseSnapshot(forkHistoryIndex: number): TurnSnapshot {
  return {
    forkHistoryIndex,
    userContent: 'hello',
    skillId: null,
    providerId: 'lm-studio-local',
    modelId: 'model-a',
    temperature: 0.7,
    maxTokens: 4096,
    modeId: 'build',
    workAgentId: null,
    workAgentAuto: true,
    composedSystemPrompt: 'You are helpful.',
    enabledToolNames: ['read_file'],
    maxToolTurns: 25,
    historyPrefixHash: 'abc123',
  };
}

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-undo-files-1',
    name: 'Test',
    workspacePath: 'C:\\ws',
    modelId: 'model-a',
    modeId: 'build',
    history: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'reply A' },
    ],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    lastMessageAt: 1,
    runs: [],
    ...overrides,
  };
}

function installChat(chat: Chat): void {
  setSessionStateForTests({
    version: 2,
    activeId: chat.id,
    sidebarCollapsed: false,
    lastActiveChatIdByWorkspace: {},
    chats: [chat],
    groups: [],
    activeBoardGroupId: null,
  });
}

function seedTurnWithSnapshots(chat: Chat): void {
  const run = createRun(chat, baseSnapshot(0));
  finalizeRun(chat, run.runId, {
    status: 'completed',
    outputHistoryStart: 1,
    outputHistoryEnd: 1,
    outputMessages: [{ role: 'assistant', content: 'reply A' }],
  });
  run.preTurnSnapshotSha = FIXED_PRE;
  run.postTurnSnapshotSha = FIXED_POST;
  run.headShaAtTurn = FIXED_HEAD;
  run.snapshotCwd = 'C:\\ws';
}

afterEach(() => {
  streamingChatIds.clear();
  // Null state first so a flushed save cannot start putSessions / hub import.
  setSessionStateForTests(null);
  flushScheduledSessionSaveForTests();
  diffFiles = [{ status: 'M', path: 'src/app.ts' }];
  currentHead = FIXED_HEAD;
  restoreCalls = [];
  restoreShouldFail = false;
});

describe('undo-turn file restore', () => {
  test('restores pre snapshot after confirm', async () => {
    const chat = makeChat();
    installChat(chat);
    seedTurnWithSnapshots(chat);

    const confirmCalls: unknown[] = [];
    const result = await undoLastAgentTurn(chat.id, {
      git: mockGit(),
      confirm: (info) => {
        confirmCalls.push(info);
        return true;
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.filesRestored, true);
    assert.equal(result.safetySnapshotSha, FIXED_SAFETY);
    assert.equal(chat.history.length, 1);
    assert.equal(restoreCalls.length, 1);
    assert.equal(restoreCalls[0]?.sha, FIXED_PRE);
    assert.equal(confirmCalls.length, 1);
  });

  test('cancel confirm leaves chat history intact', async () => {
    const chat = makeChat();
    installChat(chat);
    seedTurnWithSnapshots(chat);

    const result = await undoLastAgentTurn(chat.id, {
      git: mockGit(),
      confirm: () => false,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'cancelled');
    assert.equal(chat.history.length, 2);
    assert.equal(restoreCalls.length, 0);
  });

  test('divergence sets divergentHead on confirm info', async () => {
    const chat = makeChat();
    installChat(chat);
    seedTurnWithSnapshots(chat);
    currentHead = FIXED_MOVED_HEAD;

    let sawDivergent = false;
    await undoLastAgentTurn(chat.id, {
      git: mockGit(),
      confirm: (info) => {
        sawDivergent = info.divergentHead === true;
        return true;
      },
    });
    assert.equal(sawDivergent, true);
  });

  test('restoreFiles false skips git restore', async () => {
    const chat = makeChat();
    installChat(chat);
    seedTurnWithSnapshots(chat);

    const result = await undoLastAgentTurn(chat.id, {
      restoreFiles: false,
      git: mockGit(),
    });
    assert.equal(result.ok, true);
    assert.equal(result.filesRestored, false);
    assert.equal(restoreCalls.length, 0);
    assert.equal(chat.history.length, 1);
  });

  test('chat undo still works when run has no snapshot SHAs', async () => {
    const chat = makeChat();
    installChat(chat);
    const run = createRun(chat, baseSnapshot(0));
    finalizeRun(chat, run.runId, {
      status: 'completed',
      outputHistoryStart: 1,
      outputHistoryEnd: 1,
      outputMessages: [{ role: 'assistant', content: 'reply A' }],
    });

    const result = await undoLastAgentTurn(chat.id, {
      git: mockGit(),
      confirm: () => {
        throw new Error('confirm should not run without SHAs');
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.filesRestored, false);
    assert.equal(restoreCalls.length, 0);
  });

  test('confirmAndRestoreTurnSnapshot restores post on redo', async () => {
    const chat = makeChat();
    installChat(chat);
    seedTurnWithSnapshots(chat);
    const run = chat.runs![0]!;

    const outcome = await confirmAndRestoreTurnSnapshot(run, 'post', {
      git: mockGit(),
      confirm: () => true,
    });
    assert.equal(outcome.restored, true);
    assert.equal(restoreCalls[0]?.sha, FIXED_POST);
  });

  test('soft-fails restore after chat rewind when git restore errors', async () => {
    const chat = makeChat();
    installChat(chat);
    seedTurnWithSnapshots(chat);
    restoreShouldFail = true;

    const result = await undoLastAgentTurn(chat.id, {
      git: mockGit(),
      confirm: () => true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.filesRestored, false);
    assert.equal(chat.history.length, 1);
  });

  test('formatSnapshotRestoreConfirm caps path list and labels diverge as danger', () => {
    const many = Array.from({ length: 22 }, (_, i) => `file-${i}.ts`);
    const body = formatSnapshotRestoreConfirm({
      kind: 'undo',
      divergentHead: true,
      files: many,
    });
    assert.match(body, /before the agent turn/);
    assert.match(body, /HEAD has moved/);
    assert.match(body, /…and 2 more/);
    assert.match(body, /Staged changes will be replaced/);

    const labels = snapshotRestoreConfirmLabels({
      kind: 'redo',
      divergentHead: true,
      files: ['a.ts'],
    });
    assert.equal(labels.title, 'Restore files after this turn?');
    assert.equal(labels.confirmLabel, 'Restore files');
    assert.equal(labels.cancelLabel, 'Keep files');
    assert.equal(labels.danger, true);
  });
});
