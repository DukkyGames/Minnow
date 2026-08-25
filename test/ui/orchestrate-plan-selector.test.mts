import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals } from '../os/dom-helpers.mts';
import {
  shouldMountOrchestratePlanInInputRow,
  syncOrchestratePlanStripFromActiveChat,
} from '../../src/ui/orchestrate-plan-selector.ts';
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';

describe('shouldMountOrchestratePlanInInputRow', () => {
  test('false outside Orchestrate mode', () => {
    assert.equal(
      shouldMountOrchestratePlanInInputRow({ modeId: 'build' }),
      false,
    );
  });

  test('false in Orchestrate board view (plan strip lives in toolbar, not input row)', () => {
    assert.equal(
      shouldMountOrchestratePlanInInputRow({
        modeId: 'orchestrate',
        viewMode: 'board',
        orchestrateBoard: undefined,
      }),
      false,
    );
  });

  test('false in Orchestrate chat view (textarea stays visible for direct chatting)', () => {
    assert.equal(
      shouldMountOrchestratePlanInInputRow({
        modeId: 'orchestrate',
        viewMode: 'chat',
        orchestrateBoard: { columns: [] },
      }),
      false,
    );
  });
});

describe('plan strip toolbar placement', () => {
  let windowInstance: Window | null = null;

  afterEach(() => {
    windowInstance?.close();
    windowInstance = null;
    setSessionStateForTests(null);
  });

  // Regression: compact parks both the plan strip and its `#workAgentDev`
  // anchor in the cog sheet, so insertBefore against the toolbar threw
  // NotFoundError when a new chat synced the strip.
  test('compact-parked strip is left in the cog sheet, not re-inserted', async () => {
    windowInstance = new Window();
    installHappyDomGlobals(windowInstance);

    const bar = document.createElement('div');
    bar.className = 'input-bar';
    const row = document.createElement('div');
    row.id = 'composerControls';
    row.className = 'composer-controls composer-controls--compact';
    const wrap = document.createElement('div');
    wrap.className = 'input-wrap';
    const page = document.createElement('div');
    page.id = 'composerOverflowSettingsPage';

    const strip = document.createElement('div');
    strip.id = 'orchestratePlanStrip';
    const select = document.createElement('select');
    select.id = 'orchestratePlanSelect';
    const hint = document.createElement('span');
    hint.id = 'orchestratePlanHint';
    strip.append(select, hint);
    const workAgentDev = document.createElement('div');
    workAgentDev.id = 'workAgentDev';
    page.append(strip, workAgentDev);

    bar.append(row, wrap);
    document.body.append(bar, page);

    const chat = createEmptyChatObject('');
    chat.modeId = 'build';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    await syncOrchestratePlanStripFromActiveChat();

    assert.equal(strip.parentElement?.id, 'composerOverflowSettingsPage');
    assert.equal(strip.classList.contains('hidden'), true);
  });
});
