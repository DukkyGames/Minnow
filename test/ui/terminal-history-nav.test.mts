import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistoryClearInput,
  buildHistoryReplaceInput,
  HISTORY_LINE_CLEAR,
  isTerminalEscapeInput,
  parseHistoryArrow,
  resolveHistoryNavigation,
  usesShellNativeHistory,
} from '../../src/ui/terminal-history-nav.ts';

describe('terminal-history-nav', () => {
  it('buildHistoryReplaceInput clears the shell line then writes next line', () => {
    assert.equal(
      buildHistoryReplaceInput('abc', 'ls -la'),
      `${HISTORY_LINE_CLEAR}ls -la`,
    );
    assert.equal(buildHistoryReplaceInput('', 'pwd'), `${HISTORY_LINE_CLEAR}pwd`);
  });

  it('buildHistoryClearInput sends readline clear sequence', () => {
    assert.equal(buildHistoryClearInput('hi'), HISTORY_LINE_CLEAR);
    assert.equal(buildHistoryClearInput(''), HISTORY_LINE_CLEAR);
  });

  it('parseHistoryArrow recognizes CSI and SS3 arrow keys', () => {
    assert.equal(parseHistoryArrow('\x1b[A'), 'up');
    assert.equal(parseHistoryArrow('\x1b[B'), 'down');
    assert.equal(parseHistoryArrow('\x1bOA'), 'up');
    assert.equal(parseHistoryArrow('\x1bOB'), 'down');
    assert.equal(parseHistoryArrow('\x1b[0;1A'), 'up');
    assert.equal(parseHistoryArrow('\x1b[1;5B'), 'down');
    assert.equal(parseHistoryArrow('\x1b[C'), null);
    assert.equal(parseHistoryArrow('a'), null);
  });

  it('usesShellNativeHistory defers to PSReadLine/cmd on Windows native shells', () => {
    assert.equal(usesShellNativeHistory('powershell'), true);
    assert.equal(usesShellNativeHistory('cmd'), true);
    assert.equal(usesShellNativeHistory('bash'), false);
    assert.equal(usesShellNativeHistory('wsl:Ubuntu'), false);
    assert.equal(usesShellNativeHistory(null), false);
  });

  it('resolveHistoryNavigation walks up through history', () => {
    const tabHistory = ['first', 'second', 'third'];
    let historyIndex = 3;

    let nav = resolveHistoryNavigation({ historyIndex, tabHistory }, 'up');
    historyIndex = nav.historyIndex;
    assert.equal(historyIndex, 2);
    assert.equal(nav.nextLine, 'third');

    nav = resolveHistoryNavigation({ historyIndex, tabHistory }, 'up');
    historyIndex = nav.historyIndex;
    assert.equal(historyIndex, 1);
    assert.equal(nav.nextLine, 'second');

    nav = resolveHistoryNavigation({ historyIndex, tabHistory }, 'up');
    historyIndex = nav.historyIndex;
    assert.equal(historyIndex, 0);
    assert.equal(nav.nextLine, 'first');

    nav = resolveHistoryNavigation({ historyIndex, tabHistory }, 'up');
    historyIndex = nav.historyIndex;
    assert.equal(historyIndex, 0);
    assert.equal(nav.nextLine, 'first');
  });

  it('resolveHistoryNavigation walks down and clears past newest entry', () => {
    const tabHistory = ['first', 'second'];
    let historyIndex = 0;

    let nav = resolveHistoryNavigation({ historyIndex, tabHistory }, 'down');
    historyIndex = nav.historyIndex;
    assert.equal(historyIndex, 1);
    assert.equal(nav.nextLine, 'second');

    nav = resolveHistoryNavigation({ historyIndex, tabHistory }, 'down');
    historyIndex = nav.historyIndex;
    assert.equal(historyIndex, 2);
    assert.equal(nav.nextLine, '');
  });
});
