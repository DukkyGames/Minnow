/**
 * What the model sees after a restart must equal what it saw before one.
 *
 * The storage layer is the half that has to be byte-exact: every field the prompt
 * builder reads back — `thinking`, `thinkingSignature`, `tool_calls`, the UI-only
 * `injection` rows that Phase 1 replays, and the `failed` partial a broken turn
 * leaves behind — has to survive the SQLite round-trip untouched.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { closeSessionsDb } from '../../server/config/sessions-db.js';
import {
  readChatHistory,
  readWholeSessionState,
  writeWholeSessionState,
} from '../../server/config/sessions-repo.js';
// @ts-expect-error - JS helper without type declarations
import { rmTestHome, setTestHome } from './test-helpers.js';

const CHAT_ID = '33333333-3333-3333-3333-333333333333';

/** Every persisted message shape the send path reads back on a later turn. */
const HISTORY: unknown[] = [
  { role: 'user', content: 'What does AGENTS.md say about samplers?' },
  {
    role: 'injection',
    kind: 'context-documents',
    body: '# AGENTS.md\n\nLoop control uses presence_penalty, never repetition_penalty.',
    createdAt: 1_700_000_000_000,
  },
  {
    role: 'injection',
    kind: 'code-map',
    body: 'src/chat/prompts/compose-context.ts — buildComposeContext',
    createdAt: 1_700_000_000_001,
  },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"AGENTS.md"}' },
      },
    ],
    thinking: ['I should read the file first.', 'Then quote the sampler rule.'],
    thinkingSignature: 'sig_abc123',
    thinkingDurationMs: 1_450,
  },
  { role: 'tool', tool_call_id: 'call_1', content: '# AGENTS.md\n…' },
  {
    role: 'assistant',
    content: 'It says loop control goes through presence_penalty.',
    thinking: ['The answer is in the sampler section.'],
    thinkingDurationMs: 300,
    stats: { tokensPerSecond: 42 },
  },
  { role: 'user', content: 'And the second turn?' },
  {
    role: 'assistant',
    content: 'Partial answer before the provi',
    failed: true,
    thinking: ['Starting to draft the comparison.'],
  },
];

function stateWithHistory(): Record<string, unknown> {
  return {
    version: 6,
    activeId: CHAT_ID,
    sidebarCollapsed: false,
    groups: [],
    chats: [
      {
        id: CHAT_ID,
        name: 'Restart fidelity',
        workspacePath: '',
        modelId: 'test-model',
        history: structuredClone(HISTORY),
        lastStats: null,
        modelInfo: {},
        updatedAt: 1_700_000_000_002,
        lastMessageAt: 1_700_000_000_002,
      },
    ],
  };
}

describe('restart context fidelity', () => {
  let homeDir: string;
  let savedHome: string | undefined;
  let savedStore: string | undefined;

  before(() => {
    savedHome = process.env.MINNOW_HOME;
    savedStore = process.env.MINNOW_SESSIONS_STORE;
    delete process.env.MINNOW_SESSIONS_STORE;
    homeDir = setTestHome(process.env, `minnow-restart-fidelity-${Date.now()}`);
    writeWholeSessionState(stateWithHistory());
  });

  after(() => {
    closeSessionsDb();
    if (savedHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = savedHome;
    if (savedStore === undefined) delete process.env.MINNOW_SESSIONS_STORE;
    else process.env.MINNOW_SESSIONS_STORE = savedStore;
    return rmTestHome(homeDir);
  });

  test('every message payload round-trips byte-for-byte', () => {
    const restored = readChatHistory(CHAT_ID);
    assert.deepEqual(restored, JSON.parse(JSON.stringify(HISTORY)));
  });

  test('the whole-state read returns the full unpaged transcript', () => {
    const state = readWholeSessionState() as { chats: Array<{ id: string; history: unknown[] }> };
    const chat = state.chats.find((c) => c.id === CHAT_ID);
    assert.ok(chat, 'chat missing after restart');
    assert.equal(chat.history.length, HISTORY.length);
  });

  test('injection rows survive, so Phase 1 has bodies to replay', () => {
    const restored = readChatHistory(CHAT_ID) as Array<{
      role: string;
      kind?: string;
      body?: string;
    }>;
    const injections = restored.filter((m) => m.role === 'injection');
    assert.deepEqual(
      injections.map((m) => m.kind),
      ['context-documents', 'code-map'],
    );
    assert.ok(injections[0].body?.includes('presence_penalty'));
  });

  test('assistant reasoning and tool-call signatures survive', () => {
    const restored = readChatHistory(CHAT_ID) as Array<Record<string, unknown>>;
    const toolTurn = restored.find((m) => Array.isArray(m.tool_calls));
    assert.ok(toolTurn, 'tool-call turn missing after restart');
    assert.equal(toolTurn.thinkingSignature, 'sig_abc123');
    assert.deepEqual(toolTurn.thinking, [
      'I should read the file first.',
      'Then quote the sampler rule.',
    ]);
  });

  test('a failed turn keeps its partial text, reasoning, and chip flag', () => {
    const restored = restoredFailedRow();
    assert.equal(restored.failed, true);
    assert.equal(restored.content, 'Partial answer before the provi');
    assert.deepEqual(restored.thinking, ['Starting to draft the comparison.']);
  });

  function restoredFailedRow(): Record<string, unknown> {
    const restored = readChatHistory(CHAT_ID) as Array<Record<string, unknown>>;
    const row = restored.find((m) => m.failed === true);
    assert.ok(row, 'failed partial row missing after restart');
    return row;
  }
});
