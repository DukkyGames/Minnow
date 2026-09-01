/**
 * P6-D: every product send goes through `runTurn()`. No dual-path flag.
 */

import '../tools/install-dom-before-imports.mts';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, test } from 'node:test';
import type { Chat } from '../../src/types.ts';
import {
  createEmptyChatObject,
  flushScheduledSessionSaveForTests,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import { endChatTurnSetup } from '../../src/chat/chat-turn-guard.ts';
import { getChatAbort, setChatAbort, setStreaming } from '../../src/app-state.ts';
import { DEFAULT_TITLES_CONFIG, setTitlesConfigForTests } from '../../src/config/titles-meta.ts';
import {
  appendIsolatedProductRows,
  maybeRunChatTurnViaRunner,
  resetRunTurnForTests,
  setRunTurnForTests,
} from '../../src/chat/run-turn-chat.ts';
import type { RunTurnOptions, TurnResult } from '../../server/runner/run-turn';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function installChatDom(): void {
  document.body.replaceChildren();
  const chatArea = document.createElement('div');
  chatArea.id = 'chatArea';
  document.body.appendChild(chatArea);

  const sDot = document.createElement('span');
  sDot.id = 'sDot';
  document.body.appendChild(sDot);
  const sText = document.createElement('span');
  sText.id = 'sText';
  document.body.appendChild(sText);

  const msgInput = document.createElement('textarea');
  msgInput.id = 'msgInput';
  document.body.appendChild(msgInput);
}

function makeChat(): Chat {
  const chat = createEmptyChatObject('m1');
  chat.id = CHAT_ID;
  chat.providerId = 'vite-fallback';
  chat.modelId = 'm1';
  return chat;
}

const SIMPLE_TURN = {
  pushUser: true as const,
  rawText: 'What time is it?',
  userText: 'What time is it?',
  skillId: null,
  displayText: 'What time is it?',
  historyContent: 'What time is it?',
  validAttachments: [] as [],
  ownsGlobalStreaming: true,
};

describe('P6-D runTurn chat adapter (MIN-726)', () => {
  afterEach(() => {
    resetRunTurnForTests();
    getChatAbort(CHAT_ID)?.abort();
    setChatAbort(CHAT_ID, null);
    setStreaming(false, CHAT_ID);
    endChatTurnSetup(CHAT_ID);
    flushScheduledSessionSaveForTests();
    setSessionStateForTests(null);
    setTitlesConfigForTests({ ...DEFAULT_TITLES_CONFIG, enabled: false });
  });

  test('simple turn always invokes runTurn (no dual-path flag)', async () => {
    setTitlesConfigForTests({ ...DEFAULT_TITLES_CONFIG, enabled: false });
    installChatDom();
    const calls: RunTurnOptions[] = [];
    setRunTurnForTests(async (options) => {
      calls.push(options);
      options.onEvent?.({ type: 'thinking', text: 'checking the clock' });
      options.onEvent?.({ type: 'delta', text: 'It is noon.' });
      options.onEvent?.({
        type: 'tool_call',
        name: 'get_datetime',
        id: 'call_dt',
        arguments: '{}',
      });
      options.onEvent?.({
        type: 'tool_result',
        name: 'get_datetime',
        id: 'call_dt',
        content: '2026-08-31T12:00:00.000Z',
      });
      return { outcome: 'no_report' } satisfies TurnResult;
    });

    const chat = makeChat();
    setSessionStateForTests({
      version: 3,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const { runChatTurn } = await import('../../src/chat/run-turn-chat.ts');
    await runChatTurn({
      chat,
      ...SIMPLE_TURN,
    });

    assert.equal(calls.length, 1, 'runTurn must be invoked, not merely imported');
    assert.equal(calls[0]?.chatId, CHAT_ID);
    assert.equal(calls[0]?.seed, 'What time is it?');
    assert.equal(calls[0]?.seedKind, 'continue');
    assert.equal(calls[0]?.injectReportTool, false);
    assert.equal(calls[0]?.nudgeToolUse, false);
    assert.equal(calls[0]?.finalizeStructuredOutcome, false);
    assert.ok(typeof calls[0]?.systemPrompt === 'string' && calls[0].systemPrompt.length > 0);
    const toolNames = (calls[0]?.tools ?? []).map((t) => t.function.name);
    assert.equal(toolNames.includes('report_outcome'), false, 'chat must not inject report_outcome');
    assert.ok(toolNames.length > 0, 'mode catalog (or spike floor) must be passed');
    assert.equal(typeof calls[0]?.onEvent, 'function');
    assert.equal(typeof calls[0]?.ask?.ask, 'function', 'P6-B: adapter must inject AskCapability');
    assert.ok(typeof calls[0]?.askTimeoutMs === 'number' && calls[0].askTimeoutMs > 0);
    assert.ok(chat.history.some((m) => m.role === 'user'));
    const area = document.getElementById('chatArea');
    assert.ok(area?.querySelector('.msg-bubble'), 'delta must paint the assistant bubble');
    assert.ok(area?.querySelector('.tool-call-msg'), 'tool_call must paint a tool row');
  });

  test('leftover exclusive shapes still invoke runTurn (attachments, Super Plan, resume, skill)', async () => {
    setTitlesConfigForTests({ ...DEFAULT_TITLES_CONFIG, enabled: false });
    installChatDom();
    const seeds: Array<{ seed: string; inject: boolean | undefined }> = [];
    setRunTurnForTests(async (options) => {
      seeds.push({ seed: options.seed, inject: options.injectReportTool });
      return { outcome: 'no_report' };
    });
    const chat = makeChat();
    setSessionStateForTests({
      version: 3,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const { runChatTurn } = await import('../../src/chat/run-turn-chat.ts');
    await runChatTurn({
      chat,
      pushUser: true,
      rawText: 'see this',
      userText: 'see this',
      skillId: 'impeccable',
      historyContent: 'see this\n\n[image: shot.png]',
      validAttachments: [
        {
          id: 'att-1',
          name: 'shot.png',
          kind: 'image',
          mimeType: 'image/png',
          size: 8,
          dataUrl: 'data:image/png;base64,c2hvdA==',
        },
      ],
      superPlanStage: 'grill',
      suppressUserEcho: true,
    });
    await runChatTurn({
      chat,
      pushUser: false,
      rawText: '',
      userText: '',
      skillId: null,
      historyContent: '',
      validAttachments: [],
      resumeGenerationId: 'gen-resume-1',
      ownsGlobalStreaming: false,
    });

    assert.ok(seeds.length >= 2, 'attachments/Super Plan/skill and resume must both call runTurn');
    assert.ok(seeds.every((s) => s.inject === false));
  });

  test('adapter imports isomorphic runner index, not node.js or tool-dispatch', () => {
    const src = fs.readFileSync(
      path.join(PROJECT_ROOT, 'src', 'chat', 'run-turn-chat.ts'),
      'utf8',
    );
    const importLines = src.split('\n').filter((line) => /^\s*import\b/.test(line));
    assert.ok(
      importLines.some((line) => /server\/runner\/index\.js/.test(line)),
      'must import runTurn from the isomorphic barrel',
    );
    assert.equal(
      importLines.some((line) => /server\/runner\/node/.test(line)),
      false,
    );
    assert.equal(
      importLines.some((line) => /tool-dispatch/.test(line)),
      false,
    );
  });

  test('maybeRunChatTurnViaRunner always routes (flag deleted)', async () => {
    setTitlesConfigForTests({ ...DEFAULT_TITLES_CONFIG, enabled: false });
    installChatDom();
    let called = 0;
    setRunTurnForTests(async () => {
      called += 1;
      return { outcome: 'no_report' };
    });
    const chat = makeChat();
    setSessionStateForTests({
      version: 3,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });
    const routed = await maybeRunChatTurnViaRunner({
      chat,
      ...SIMPLE_TURN,
    });
    assert.equal(routed, true);
    assert.equal(called, 1);
  });

  test('appendIsolatedProductRows copies assistant/tool and skips system/user nudges', () => {
    const chat = makeChat();
    appendIsolatedProductRows(chat, [
      { role: 'system', content: 'When you have a result, call the report tool.' },
      { role: 'user', content: 'What time is it?' },
      { role: 'assistant', content: 'Let me check.' },
      { role: 'tool', content: 'noon' },
      { role: 'user', content: 'Please call a tool.' },
      { role: 'assistant', content: 'It is noon.' },
    ]);
    assert.deepEqual(
      chat.history.map((m) => m.role),
      ['assistant', 'tool', 'assistant'],
    );
  });

  test('src has no tools/loop imports after P6-D', () => {
    const srcDir = path.join(PROJECT_ROOT, 'src');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|js|mjs|mts)$/.test(ent.name)) continue;
        const text = fs.readFileSync(full, 'utf8');
        if (text.includes('tools/loop')) hits.push(path.relative(PROJECT_ROOT, full));
      }
    };
    walk(srcDir);
    assert.deepEqual(hits, [], 'rg tools/loop src must be empty');
  });
});
