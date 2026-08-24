import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

import {
  buildSuperPlanPageDom,
  seedSuperPlanLedgerForTests,
  syncSuperPlanPage,
  teardownSuperPlanPage,
  type SuperPlanPageHandlers,
} from '../../src/ui/super-plan-page.ts';
import {
  collectSuperPlanRuns,
  formatRelativeTime,
  groupPlanLibraryEntries,
  titleFromPlanPath,
  type PlanLibraryEntry,
} from '../../src/chat/super-plan/plan-library.ts';
import { createInitialSuperPlanStages } from '../../src/chat/super-plan/state.ts';
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';
import { resetWorkspaceStateForTests, setWorkspaceFromServer } from '../../src/state/workspace.ts';
import type { Chat } from '../../src/types.ts';
import { streamingChatIds } from '../../src/app-state.ts';
import {
  ActivityLogBuffer,
  type ActivityLogEntry,
} from '../../src/research/activity-log.ts';
import { PlanActivityCollector } from '../../src/ui/plan-activity-collector.ts';

let activeWindow: Window | undefined;

function installTestWindow(): void {
  activeWindow?.close();
  const window = new Window();
  activeWindow = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
}

const calls: string[] = [];

function stubHandlers(): SuperPlanPageHandlers {
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push(args.length ? `${name}:${String(args[0])}` : name);
    };
  return {
    onStart: record('onStart'),
    onPause: record('onPause'),
    onResume: record('onResume'),
    onStop: record('onStop'),
    onSkipInterview: record('onSkipInterview'),
    onConfirmSpec: record('onConfirmSpec'),
    onReviseSpec: record('onReviseSpec'),
    onRetryStage: record('onRetryStage'),
    onSkipStage: record('onSkipStage'),
    onCancelPipeline: record('onCancelPipeline'),
    onRework: record('onRework'),
    onOrchestrate: record('onOrchestrate'),
    onBuild: record('onBuild'),
    onRevisePlan: record('onRevisePlan'),
    onSelectRun: record('onSelectRun'),
    onOpenPlanFile: record('onOpenPlanFile'),
    onNewPlan: record('onNewPlan'),
    onDeleteEntry: record('onDeleteEntry'),
  };
}

/** Super-plan chat parked on `activeStage`, with everything before it done. */
function makeRunChat(
  id: string,
  activeStage: Parameters<typeof createInitialSuperPlanStages> extends never
    ? never
    : Chat['superPlan'] extends { activeStage: infer S } | undefined
      ? S
      : never,
  overrides: Partial<NonNullable<Chat['superPlan']>> = {},
): Chat {
  const chat = createEmptyChatObject(id);
  chat.modeId = 'super-plan';
  const stages = createInitialSuperPlanStages();
  chat.superPlan = {
    slug: 'offline-queue',
    prompt: 'Add offline queueing to the sync layer',
    activeStage,
    stages,
    ...overrides,
  };
  return chat;
}

function mountPage(chat: Chat, mode: 'compose' | 'run' = 'run'): HTMLElement {
  setSessionStateForTests({
    version: 5,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });
  const root = buildSuperPlanPageDom({ chatId: chat.id, mode, handlers: stubHandlers() });
  document.body.appendChild(root);
  return root;
}

function textOf(root: ParentNode, selector: string): string {
  return (root.querySelector(selector)?.textContent ?? '').trim();
}

describe('super plan page', () => {
  afterEach(() => {
    streamingChatIds.clear();
    teardownSuperPlanPage();
    calls.length = 0;
    setSessionStateForTests(null);
    activeWindow?.close();
    activeWindow = undefined;
  });

  test('pipeline column lists every stage and marks the running one', () => {
    installTestWindow();
    const chat = makeRunChat('sp1', 'research');
    chat.superPlan!.stages.grill.status = 'done';
    chat.superPlan!.stages.grill.startedAt = 1_000;
    chat.superPlan!.stages.grill.finishedAt = 61_000;
    chat.superPlan!.stages.spec_confirm.status = 'done';
    chat.superPlan!.stages.research.status = 'running';
    chat.superPlan!.stages.research.startedAt = Date.now();
    // Without an in-flight turn the controller reports the run as stalled.
    streamingChatIds.add(chat.id);

    const root = mountPage(chat);
    syncSuperPlanPage(chat);

    const stages = [...root.querySelectorAll('.sp-stage')];
    assert.equal(stages.length, 10, 'all ten pipeline stages stay visible');
    assert.ok(stages[0]?.classList.contains('is-done'));
    assert.equal(textOf(stages[0]!, '.sp-stage__time'), '1:00');
    assert.ok(
      stages[2]?.classList.contains('is-running'),
      'the active stage reads as running',
    );
    assert.ok(
      stages[9]?.classList.contains('is-done') === false,
      'later stages are not marked done',
    );
  });

  test('a paused pipeline never renders a running stage', () => {
    installTestWindow();
    const chat = makeRunChat('sp2', 'draft1', { paused: true });
    chat.superPlan!.stages.draft1.status = 'running';
    chat.superPlan!.stages.draft1.startedAt = Date.now();

    const root = mountPage(chat);
    syncSuperPlanPage(chat);

    assert.equal(
      root.querySelectorAll('.sp-stage.is-running').length,
      0,
      'nothing breathes while the pipeline is standing still',
    );
    assert.equal(root.querySelectorAll('.sp-stage.is-halted').length, 1);
    assert.equal(textOf(root, '.sp-runhead__meta .sp-state'), 'paused');
  });

  test('completed stages offer rework, pending ones do not', () => {
    installTestWindow();
    const chat = makeRunChat('sp3', 'draft1');
    chat.superPlan!.stages.grill.status = 'done';
    chat.superPlan!.stages.spec_confirm.status = 'done';
    chat.superPlan!.stages.research.status = 'done';

    const root = mountPage(chat);
    syncSuperPlanPage(chat);

    const clickable = [...root.querySelectorAll('.sp-stage--clickable')];
    assert.equal(clickable.length, 3);
    assert.equal(clickable[0]?.tagName, 'BUTTON');
    (clickable[0] as HTMLButtonElement).click();
    assert.deepEqual(calls, ['onRework:grill']);
  });

  test('spec checkpoint docks confirm and revise', () => {
    installTestWindow();
    const chat = makeRunChat('sp4', 'spec_confirm', {
      specPath: 'documentation/plans/references/offline-queue-spec.md',
    });
    chat.superPlan!.stages.grill.status = 'done';
    chat.superPlan!.stages.spec_confirm.status = 'blocked_user';
    chat.superPlan!.stages.spec_confirm.artifactPath =
      'documentation/plans/references/offline-queue-spec.md';

    const root = mountPage(chat);
    syncSuperPlanPage(chat);

    const dock = root.querySelector('.sp-dock') as HTMLElement | null;
    assert.ok(dock);
    assert.equal(dock.hidden, false);
    const labels = [...dock.querySelectorAll('.sp-btn')].map((b) => b.textContent);
    assert.deepEqual(labels, ['Revise spec', 'Confirm spec']);
    assert.equal(textOf(root, '.sp-runhead__meta .sp-state'), 'needs you');
    assert.equal(
      (root.querySelector('[data-plan-action="pause"]') as HTMLElement | null)?.hidden,
      true,
      'there is nothing to pause while the pipeline waits on you',
    );
  });

  test('a failed stage keeps earlier work and offers retry, skip, cancel', () => {
    installTestWindow();
    const chat = makeRunChat('sp5', 'review1');
    chat.superPlan!.stages.grill.status = 'done';
    chat.superPlan!.stages.draft1.status = 'done';
    chat.superPlan!.stages.review1.status = 'error';
    chat.superPlan!.stages.review1.error = 'Plan reviewer timed out.';

    const root = mountPage(chat);
    syncSuperPlanPage(chat);

    assert.match(textOf(root, '.sp-notice'), /Plan reviewer timed out/);
    assert.ok(root.querySelector('.sp-notice--error'));
    const labels = [...root.querySelectorAll('.sp-dock .sp-btn')].map((b) => b.textContent);
    assert.deepEqual(labels, ['Cancel pipeline', 'Skip Review 1', 'Retry Review 1']);
    assert.ok(root.querySelector('.sp-stage.is-error'));
    assert.ok(root.querySelector('.sp-stage.is-done'), 'earlier stages are kept');
  });

  test('ledger renders buffered activity once and keeps arrival order', () => {
    installTestWindow();
    const chat = makeRunChat('sp6', 'research');
    const root = mountPage(chat);
    syncSuperPlanPage(chat);

    seedSuperPlanLedgerForTests([
      { id: 'e1', atMs: 1_000, kind: 'stage', label: 'Stage', detail: 'Research · running' },
      {
        id: 'e2',
        atMs: 2_000,
        kind: 'phase',
        label: 'Searching',
        detail: 'round 1 · 2 queries',
        queries: ['durable write queue', 'replay ordering'],
      },
      {
        id: 'e3',
        atMs: 3_000,
        kind: 'warning',
        label: 'Warning',
        detail: 'One source returned 403',
        tone: 'warning',
      },
    ]);

    const ids = () =>
      [...root.querySelectorAll('.sp-entry')].map((e) => (e as HTMLElement).dataset.entryId);

    // The live collector seeds its own opening stage row, so assert on the
    // rows this test appended rather than on the total.
    assert.deepEqual(
      ids().filter((id) => id?.startsWith('e')),
      ['e1', 'e2', 'e3'],
    );
    assert.equal(root.querySelectorAll('.sp-entry__queries li').length, 2);
    assert.ok(
      root.querySelector('[data-entry-id="e3"]')?.classList.contains('sp-entry--warning'),
    );
    assert.equal(
      textOf(root, '.sp-segment .sp-segment__count'),
      String(root.querySelectorAll('.sp-entry').length),
    );

    // A repaint must not duplicate rows that are already on screen.
    const before = ids().length;
    syncSuperPlanPage(chat);
    assert.equal(root.querySelectorAll('.sp-entry').length, before);
  });

  test('composer offers the pipeline chips and refuses an empty prompt', () => {
    installTestWindow();
    const chat = makeRunChat('sp7', 'grill');
    chat.superPlan = undefined;
    const root = mountPage(chat, 'compose');

    const chips = [...root.querySelectorAll('.sp-chip')].map((c) => c.textContent ?? '');
    assert.equal(chips.length, 4);
    assert.ok(chips.some((c) => c.startsWith('Interview')));
    assert.ok(chips.some((c) => c.startsWith('Research')));
    assert.ok(chips.some((c) => /review/i.test(c)));
    assert.ok(chips.some((c) => c.startsWith('UI pass')));

    const send = root.querySelector('.sp-send') as HTMLButtonElement;
    assert.equal(send.disabled, true, 'send stays off until there is a prompt');
    send.click();
    assert.deepEqual(calls, [], 'an empty prompt never starts a run');

    const field = root.querySelector('.sp-composer__field') as HTMLTextAreaElement;
    field.value = 'Add offline queueing';
    field.dispatchEvent(new activeWindow!.Event('input', { bubbles: true }));
    assert.equal(send.disabled, false);
    send.click();
    assert.deepEqual(calls, ['onStart:Add offline queueing']);
    assert.equal(field.dataset.composerAutoResizeWired, '1');
    assert.equal(field.spellcheck, false);
  });

  test('composer CSS grows with content like the chat composer', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../src/styles/super-plan-page.css'),
      'utf8',
    );
    assert.match(css, /\.sp-composer__field\s*\{[^}]*field-sizing:\s*content/);
    assert.match(css, /\.sp-composer__field\s*\{[^}]*max-height:\s*min\(40vh,\s*320px\)/);
  });

  test('seed chips fill the composer through the input event', () => {
    installTestWindow();
    const chat = makeRunChat('sp-seed', 'grill');
    chat.superPlan = undefined;
    const root = mountPage(chat, 'compose');

    const field = root.querySelector('.sp-composer__field') as HTMLTextAreaElement;
    const send = root.querySelector('.sp-send') as HTMLButtonElement;
    const seed = root.querySelector('.sp-seed') as HTMLButtonElement;
    assert.equal(send.disabled, true);
    seed.click();
    assert.equal(field.value, seed.textContent);
    assert.equal(send.disabled, false);
  });

  test('compose surface mounts a per-chat model picker', () => {
    installTestWindow();
    document.body.innerHTML =
      '<select id="modelSelect"><option value="lm/qwen">Qwen — LM Studio</option></select>';
    const chat = makeRunChat('sp-model', 'grill');
    chat.superPlan = undefined;
    const root = mountPage(chat, 'compose');

    const anchor = root.querySelector('#superPlanComposerModelAnchor');
    assert.ok(anchor, 'model anchor');
    assert.ok(
      anchor?.querySelector('.composer-model-trigger-wrap--super-plan'),
      'super-plan model trigger',
    );
    teardownSuperPlanPage();
  });

  test('chip popovers open one at a time', () => {
    installTestWindow();
    const chat = makeRunChat('sp8', 'grill');
    chat.superPlan = undefined;
    const root = mountPage(chat, 'compose');

    const chips = [...root.querySelectorAll('.sp-chip')] as HTMLButtonElement[];
    chips[0]!.click();
    assert.equal(chips[0]!.getAttribute('aria-expanded'), 'true');
    chips[1]!.click();
    assert.equal(chips[0]!.getAttribute('aria-expanded'), 'false');
    assert.equal(chips[1]!.getAttribute('aria-expanded'), 'true');
    assert.equal(root.querySelectorAll('.sp-pop:not([hidden])').length, 1);
  });
});

describe('super plan library', () => {
  afterEach(() => {
    resetWorkspaceStateForTests();
    setSessionStateForTests(null);
  });

  test('collectSuperPlanRuns only includes chats in the requested workspace', () => {
    const wsA = '/tmp/workspace-a';
    const wsB = '/tmp/workspace-b';
    setWorkspaceFromServer({ path: wsA, label: 'A', isDefault: false });

    const chatA = makeRunChat('sp-ws-a', 'grill');
    chatA.workspacePath = wsA;
    const chatB = makeRunChat('sp-ws-b', 'research');
    chatB.workspacePath = wsB;

    setSessionStateForTests({
      version: 5,
      activeId: chatA.id,
      sidebarCollapsed: false,
      chats: [chatA, chatB],
    });

    const inA = collectSuperPlanRuns(wsA);
    assert.equal(inA.length, 1);
    assert.equal(inA[0]?.chatId, chatA.id);

    const inB = collectSuperPlanRuns(wsB);
    assert.equal(inB.length, 1);
    assert.equal(inB[0]?.chatId, chatB.id);
  });

  test('titles come from the plan slug', () => {
    assert.equal(
      titleFromPlanPath('documentation/plans/server-session-engine.md'),
      'Server session engine',
    );
    assert.equal(titleFromPlanPath('offline_queue.md'), 'Offline queue');
  });

  test('live runs group above history, stopped runs file by date', () => {
    const now = Date.UTC(2026, 7, 7, 12, 0, 0);
    const entry = (
      key: string,
      state: PlanLibraryEntry['state'],
      atMs: number,
    ): PlanLibraryEntry => ({
      key,
      path: `documentation/plans/${key}.md`,
      title: key,
      state,
      atMs,
      executable: true,
    });

    const groups = groupPlanLibraryEntries(
      [
        entry('running', 'running', now - 1000),
        entry('stopped', 'cancelled', now - 1000),
        entry('old', 'saved', now - 20 * 86_400_000),
      ],
      now,
    );

    assert.deepEqual(
      groups.map((g) => g.label),
      ['In progress', 'Today', 'Earlier'],
    );
    assert.deepEqual(groups[0]!.entries.map((e) => e.key), ['running']);
    assert.deepEqual(groups[1]!.entries.map((e) => e.key), ['stopped']);
    assert.deepEqual(groups[2]!.entries.map((e) => e.key), ['old']);
  });

  test('a library with no timestamps collapses to one group', () => {
    const rows: PlanLibraryEntry[] = [
      { key: 'a', path: 'a.md', title: 'a', state: 'saved', executable: false },
      { key: 'b', path: 'b.md', title: 'b', state: 'saved', executable: false },
    ];
    const groups = groupPlanLibraryEntries(rows, Date.now());
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.label, '');
  });

  test('relative time stays compact', () => {
    const now = Date.UTC(2026, 7, 7, 12, 0, 0);
    assert.equal(formatRelativeTime(now - 30_000, now), 'just now');
    assert.equal(formatRelativeTime(now - 5 * 60_000, now), '5m ago');
    assert.equal(formatRelativeTime(now - 3 * 3_600_000, now), '3h ago');
    assert.equal(formatRelativeTime(now - 2 * 86_400_000, now), '2d ago');
    assert.equal(formatRelativeTime(undefined, now), '');
  });
});

describe('super plan activity ledger persistence (MIN-599)', () => {
  afterEach(() => {
    setSessionStateForTests(null);
  });

  function seedEntry(
    over: Partial<ActivityLogEntry> & Pick<ActivityLogEntry, 'kind' | 'label'>,
  ): ActivityLogEntry {
    return { id: `seed-${over.label}-${over.detail ?? ''}`, atMs: 1_000, ...over };
  }

  test('replays the persisted ledger, including rows no other source can rebuild', async () => {
    const chat = makeRunChat('sp-activity-1', 'draft1');
    chat.superPlan!.stages.grill.status = 'done';
    chat.superPlan!.stages.grill.finishedAt = 2_000;
    chat.superPlan!.activityLog = [
      seedEntry({ kind: 'info', label: 'Model', detail: 'thinking…' }),
      seedEntry({ kind: 'sub-agent', label: 'Reviewer', detail: 'running' }),
      seedEntry({ kind: 'stage', label: 'Stage', detail: 'Grill · done' }),
    ];
    setSessionStateForTests({ version: 5, activeId: chat.id, chats: [chat] });

    const buffer = new ActivityLogBuffer();
    const collector = new PlanActivityCollector(chat.id, buffer);
    await collector.start();
    collector.stop();

    const details = buffer.getEntries().map((e) => `${e.label}|${e.detail ?? ''}`);
    // Main-turn and reviewer rows are the bulk of the ledger and were previously
    // never persisted, so reload came back nearly empty.
    assert.ok(details.includes('Model|thinking…'));
    assert.ok(details.includes('Reviewer|running'));
    // The stage row is in both the persisted ledger and the stage replay.
    assert.equal(details.filter((d) => d.startsWith('Stage|Grill')).length, 1);
    // Replay is history, not new activity.
    assert.equal(buffer.getUnreadCount(), 0);
  });

  test('mirrors new rows back onto the chat so leaving the screen keeps them', async () => {
    const chat = makeRunChat('sp-activity-2', 'draft1');
    setSessionStateForTests({ version: 5, activeId: chat.id, chats: [chat] });

    const buffer = new ActivityLogBuffer();
    const collector = new PlanActivityCollector(chat.id, buffer);
    await collector.start();

    buffer.append(seedEntry({ kind: 'tool', label: 'Tool', detail: 'tool: write_file' }));
    collector.stop();

    const persisted = chat.superPlan!.activityLog ?? [];
    assert.ok(persisted.some((e) => e.detail === 'tool: write_file'));
  });
});
