/**
 * Boot resume gate — nothing restarts on app open until the user answers the prompt.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  collectResumeCandidates,
  parkResumeCandidatesAtBoot,
  resetResumeGateBootForTests,
  runBootResumeGate,
} from '../../src/boot/resume-gate-boot.ts';
import { getResumeGateState } from '../../src/chat/resume-gate.ts';
import { resetBoardDisplayWakeLivenessForTests } from '../../src/chat/orchestrate/board-display-wake.ts';
import { setOomPauseActiveForBoot } from '../../src/chat/orchestrate/oom-recovery.ts';
import { resetAfkBoardPowerGuardForTests } from '../../src/chat/orchestrate/board-afk-power.ts';
import { resetChromePopoverRegistryForTests } from '../../src/ui/preview-electron-visibility.ts';
import { initBoard } from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat, ChatGroup, SessionState } from '../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/resume-gate.md';

function makePlanner(): Chat {
  return {
    id: PLANNER_ID,
    name: 'Planner',
    workspacePath: '/tmp/ws',
    modeId: 'orchestrate',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    orchestratePlanPath: PLAN_PATH,
    boardGroupId: GROUP_ID,
  };
}

function makeGroupWithBoard(): { planner: Chat; group: ChatGroup } {
  const planner = makePlanner();
  const group: ChatGroup = {
    id: GROUP_ID,
    name: 'Resume gate folder',
    workspacePath: '/tmp/ws',
    collapsed: false,
    order: 0,
    createdAt: 1,
    plannerChatId: PLANNER_ID,
    orchestratePlanPath: PLAN_PATH,
    viewMode: 'board',
  };
  initBoard(group, planner, {
    planPath: PLAN_PATH,
    waves: [{ id: 'W1' }],
    tasks: [{ id: 'W1-A', title: 'Task', wave: 'W1', category: 'build', build: 'Do work' }],
  });
  const board = group.orchestrateBoard!;
  board.handsOff = true;
  board.maxConcurrentTasks = 1;
  return { planner, group };
}

function seed(planner: Chat, group: ChatGroup): SessionState {
  const state: SessionState = {
    version: 5,
    activeId: PLANNER_ID,
    chats: [planner],
    groups: [group],
  };
  setSessionStateForTests(state);
  return state;
}

/** Wait for the app-dialog shell to render, then press one of its buttons. */
async function waitForPrompt(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (isPromptOpen()) return;
  }
  assert.fail('resume prompt never rendered');
}

async function answerPrompt(action: 'confirm' | 'cancel'): Promise<void> {
  await waitForPrompt();
  const btn = document.querySelector<HTMLButtonElement>(`[data-dialog-action="${action}"]`);
  assert.ok(btn, `resume prompt button "${action}" never rendered`);
  btn.click();
}

function isPromptOpen(): boolean {
  return document.querySelector('[data-dialog-action="confirm"]') != null;
}

describe('boot resume gate', () => {
  let happyDomWindow: Window | undefined;

  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
    happyDomWindow = new Window();
    globalThis.window = happyDomWindow as unknown as Window & typeof globalThis;
    globalThis.document = happyDomWindow.document as unknown as Document;
    globalThis.HTMLElement = happyDomWindow.HTMLElement as unknown as typeof HTMLElement;
  });

  afterEach(() => {
    delete process.env.MINNOW_TEST;
    resetResumeGateBootForTests();
    resetBoardDisplayWakeLivenessForTests();
    resetAfkBoardPowerGuardForTests();
    resetChromePopoverRegistryForTests();
    setOomPauseActiveForBoot(false);
    setSessionStateForTests(null);
    happyDomWindow?.close();
    happyDomWindow = undefined;
    // @ts-expect-error test teardown
    delete globalThis.window;
    // @ts-expect-error test teardown
    delete globalThis.document;
    // @ts-expect-error test teardown
    delete globalThis.HTMLElement;
  });

  test('a finished board is not a candidate and boots without a prompt', async () => {
    const { planner, group } = makeGroupWithBoard();
    const board = group.orchestrateBoard!;
    board.tasks[0]!.status = 'complete';
    const state = seed(planner, group);

    parkResumeCandidatesAtBoot(state);
    assert.equal(getResumeGateState(), 'idle', 'nothing pending should not arm the hold');

    await runBootResumeGate(state);

    assert.equal(isPromptOpen(), false);
    assert.equal(getResumeGateState(), 'resumed');
  });

  test('parking clears autoRunning before anything can delegate', () => {
    const { planner, group } = makeGroupWithBoard();
    const board = group.orchestrateBoard!;
    // Crash shape: the app died mid-plan, so autoRunning was never cleared.
    board.autoRunning = true;
    board.tasks[0]!.status = 'in_progress';
    const state = seed(planner, group);

    parkResumeCandidatesAtBoot(state);

    assert.equal(board.autoRunning, false);
    assert.equal(getResumeGateState(), 'pending');
  });

  test('a parked board is still listed as a candidate', async () => {
    const { planner, group } = makeGroupWithBoard();
    group.orchestrateBoard!.autoRunning = true;
    const state = seed(planner, group);

    parkResumeCandidatesAtBoot(state);
    const candidates = await collectResumeCandidates(state);

    assert.equal(candidates.boards.length, 1);
    assert.equal(candidates.boards[0]!.group.id, GROUP_ID);
  });

  test('declining stops the board and leaves it restartable', async () => {
    const { planner, group } = makeGroupWithBoard();
    const board = group.orchestrateBoard!;
    board.autoRunning = true;
    board.tasks[0]!.status = 'in_progress';
    const state = seed(planner, group);

    parkResumeCandidatesAtBoot(state);
    const gate = runBootResumeGate(state);
    await answerPrompt('cancel');
    await gate;

    assert.equal(board.autoRunning, false);
    assert.equal(board.userStopped, true, 'decline should read as a user Stop');
    assert.equal(board.systemPaused, false);
    assert.equal(getResumeGateState(), 'declined');
  });

  test('declining clears a stale generation id on the active chat', async () => {
    const { planner, group } = makeGroupWithBoard();
    group.orchestrateBoard!.tasks[0]!.status = 'complete';
    planner.currentGenerationId = 'gen_11111111-1111-1111-1111-111111111111';
    const state = seed(planner, group);

    parkResumeCandidatesAtBoot(state);
    const gate = runBootResumeGate(state);
    await answerPrompt('cancel');
    await gate;

    assert.equal(planner.currentGenerationId, undefined);
  });

  test('the prompt itemizes the board and its pending task counts', async () => {
    const { planner, group } = makeGroupWithBoard();
    const board = group.orchestrateBoard!;
    board.autoRunning = true;
    board.tasks[0]!.status = 'in_progress';
    board.tasks.push({
      id: 'W1-B',
      title: 'Queued task',
      wave: 'W1',
      category: 'build',
      status: 'planned',
    });
    const state = seed(planner, group);

    parkResumeCandidatesAtBoot(state);
    const gate = runBootResumeGate(state);
    await waitForPrompt();

    const rows = [...document.querySelectorAll('.app-dialog-list__item')];
    assert.equal(rows.length, 1);
    assert.match(rows[0]!.textContent ?? '', /Resume gate folder — orchestrate board/);
    assert.match(rows[0]!.textContent ?? '', /1 in progress, 1 queued/);

    await answerPrompt('cancel');
    await gate;
  });

  test('resuming restores the parked autoRunning flag', async () => {
    const { planner, group } = makeGroupWithBoard();
    const board = group.orchestrateBoard!;
    board.autoRunning = true;
    board.tasks[0]!.status = 'in_progress';
    const state = seed(planner, group);

    parkResumeCandidatesAtBoot(state);
    const gate = runBootResumeGate(state);
    await answerPrompt('confirm');
    await gate;

    assert.equal(board.autoRunning, true);
    assert.equal(board.userStopped ?? false, false);
    assert.equal(getResumeGateState(), 'resumed');
  });

  test('a chat stamped resumeInterrupted is a candidate without a generation id', async () => {
    const { planner, group } = makeGroupWithBoard();
    group.orchestrateBoard!.tasks[0]!.status = 'complete';
    planner.resumeInterrupted = true;
    delete planner.currentGenerationId;
    const state = seed(planner, group);

    const candidates = await collectResumeCandidates(state);
    assert.equal(candidates.chats.length, 1);
    assert.equal(candidates.chats[0]!.kind, 'interrupted');

    parkResumeCandidatesAtBoot(state);
    const gate = runBootResumeGate(state);
    await waitForPrompt();
    const rows = [...document.querySelectorAll('.app-dialog-list__item')];
    assert.match(rows[0]!.textContent ?? '', /interrupted when Minnow closed/i);

    await answerPrompt('cancel');
    await gate;

    assert.equal(planner.resumeInterrupted, undefined);
    assert.equal(getResumeGateState(), 'declined');
  });

  test('declining clears resumeInterrupted together with a generation id', async () => {
    const { planner, group } = makeGroupWithBoard();
    group.orchestrateBoard!.tasks[0]!.status = 'complete';
    planner.currentGenerationId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    planner.resumeInterrupted = true;
    const state = seed(planner, group);

    parkResumeCandidatesAtBoot(state);
    const gate = runBootResumeGate(state);
    await answerPrompt('cancel');
    await gate;

    assert.equal(planner.currentGenerationId, undefined);
    assert.equal(planner.resumeInterrupted, undefined);
  });
});
