import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals } from '../os/dom-helpers.mts';

const CHAT_ID = '22222222-2222-2222-2222-222222222222';

const { createEmptyChatObject, setSessionStateForTests } = await import(
  '../../src/state/sessions.ts'
);
const { disposeModeSelectorForTests, initModeSelector } = await import(
  '../../src/ui/mode-selector.ts'
);
const {
  COMPOSER_COMPACT_ENTER_PX,
  COMPOSER_COMPACT_LEAVE_PX,
  disposeComposerCompactForTests,
  initComposerCompact,
  isComposerControlsCompact,
  nextComposerCompactState,
  refreshComposerCompactOverflow,
  syncComposerCompactFromWidth,
} = await import('../../src/ui/composer-compact.ts');

let windowInstance: Window | null = null;

function setupComposerDom(): HTMLElement {
  windowInstance = new Window();
  installHappyDomGlobals(windowInstance);

  const bar = document.createElement('div');
  bar.className = 'input-bar';

  const row = document.createElement('div');
  row.id = 'composerControls';
  row.className = 'composer-controls';

  const modeSelector = document.createElement('div');
  modeSelector.id = 'modeSelector';
  modeSelector.className = 'mode-segmented';

  const thinking = document.createElement('div');
  thinking.id = 'composerThinkingWrap';
  thinking.className = 'composer-control thinking-control-wrap';

  const wheel = document.createElement('div');
  wheel.className = 'context-usage-anchor';

  const trail = document.createElement('div');
  trail.className = 'composer-controls__trail';

  const tools = document.createElement('div');
  tools.id = 'composerToolsAnchor';
  tools.className = 'composer-tools-anchor';

  const overflowAnchor = document.createElement('div');
  overflowAnchor.className = 'composer-overflow-anchor';
  overflowAnchor.id = 'composerOverflowAnchor';
  const overflowBtn = document.createElement('button');
  overflowBtn.type = 'button';
  overflowBtn.id = 'btnComposerOverflow';
  const popover = document.createElement('div');
  popover.id = 'composerOverflowPopover';
  popover.className = 'composer-overflow-popover hidden';
  const slot = document.createElement('div');
  slot.id = 'composerOverflowSlot';
  slot.className = 'composer-overflow-slot';
  popover.appendChild(slot);
  overflowAnchor.append(overflowBtn, popover);

  trail.append(tools, overflowAnchor);
  row.append(modeSelector, thinking, wheel, trail);
  bar.appendChild(row);
  document.body.appendChild(bar);

  const chat = createEmptyChatObject('');
  chat.id = CHAT_ID;
  chat.modeId = 'plan';
  setSessionStateForTests({
    version: 2,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });

  return row;
}

afterEach(() => {
  if (windowInstance) {
    disposeComposerCompactForTests();
    disposeModeSelectorForTests();
    windowInstance.close();
    windowInstance = null;
  }
  setSessionStateForTests(null);
});

describe('composer compact overflow', () => {
  test('hysteresis: enter below 880px, leave only above 920px', () => {
    assert.equal(COMPOSER_COMPACT_ENTER_PX, 880);
    assert.equal(COMPOSER_COMPACT_LEAVE_PX, 920);
    assert.equal(nextComposerCompactState(false, 700), true);
    assert.equal(nextComposerCompactState(true, 900), true);
    assert.equal(nextComposerCompactState(true, 930), false);
    assert.equal(nextComposerCompactState(false, 900), false);
    assert.equal(nextComposerCompactState(false, 0), false);
  });

  test('compact parks extra controls and keeps mode dropdown + wheel on the row', () => {
    const row = setupComposerDom();
    initModeSelector();
    initComposerCompact();
    syncComposerCompactFromWidth(700);

    const slot = document.getElementById('composerOverflowSlot');
    const thinking = document.getElementById('composerThinkingWrap');
    const tools = document.getElementById('composerToolsAnchor');
    const wheel = row.querySelector('.context-usage-anchor');
    const dropdown = document.getElementById('modeSelectorDropdown');

    assert.equal(isComposerControlsCompact(), true);
    assert.equal(thinking?.parentElement?.id, 'composerOverflowSlot');
    assert.equal(tools?.parentElement?.id, 'composerOverflowSlot');
    assert.ok(slot);
    assert.equal(wheel?.parentElement, row);
    assert.equal(dropdown?.hidden, false);
    assert.match(dropdown?.textContent ?? '', /Plan/);
    assert.equal(dropdown?.parentElement, row);

    syncComposerCompactFromWidth(940);
    assert.equal(thinking?.parentElement, row);
    assert.equal(tools?.parentElement?.className, 'composer-controls__trail');
  });

  test('mode dropdown CSS never allows the compact trigger to shrink or clip', () => {
    const css = readFileSync(new URL('../../src/styles/mode-selector.css', import.meta.url), 'utf8');
    assert.match(css, /#modeSelectorDropdown[\s\S]*flex-shrink:\s*0/);
    assert.match(css, /#modeSelectorDropdown[\s\S]*min-width:\s*max-content/);
    assert.match(
      css,
      /\.composer-controls:not\(\.composer-controls--compact\) #modeSelector\.mode-segmented[\s\S]*min-width:\s*max-content/,
    );
  });

  test('refresh re-parks a control inserted after compact is already on', () => {
    const row = setupComposerDom();
    initModeSelector();
    initComposerCompact();
    syncComposerCompactFromWidth(700);

    const wrap = document.createElement('div');
    wrap.id = 'composerRunTargetWrap';
    row.appendChild(wrap);
    refreshComposerCompactOverflow();

    assert.equal(wrap.parentElement?.id, 'composerOverflowSlot');
  });
});
