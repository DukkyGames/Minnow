import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistoryClearInput,
  buildHistoryReplaceInput,
  HISTORY_LINE_CLEAR,
  isTerminalEscapeInput,
  parseHistoryArrow,
  resolveHistoryNavigation,
  shouldInterceptPtyHistoryArrow,
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

  it('usesShellNativeHistory defers to the shell line editor on every shipped PTY profile', () => {
    assert.equal(usesShellNativeHistory('powershell'), true);
    assert.equal(usesShellNativeHistory('cmd'), true);
    assert.equal(usesShellNativeHistory('zsh'), true);
    assert.equal(usesShellNativeHistory('bash'), true);
    assert.equal(usesShellNativeHistory('fish'), true);
    assert.equal(usesShellNativeHistory('wsl:Ubuntu'), true);
    assert.equal(usesShellNativeHistory(null), false);
  });

  it('MIN-670: used zsh/bash tabs do not intercept ArrowUp (avoids ^A^K echo)', () => {
    const usedZsh = {
      data: '\x1b[A',
      shellProfileId: 'zsh',
      tabHistoryLength: 4,
    };
    assert.equal(shouldInterceptPtyHistoryArrow(usedZsh), false);
    assert.equal(
      shouldInterceptPtyHistoryArrow({ ...usedZsh, shellProfileId: 'bash' }),
      false,
    );
    assert.equal(
      shouldInterceptPtyHistoryArrow({ ...usedZsh, shellProfileId: 'wsl:Ubuntu' }),
      false,
    );
    assert.equal(
      shouldInterceptPtyHistoryArrow({ ...usedZsh, shellProfileId: 'powershell' }),
      false,
    );
  });

  it('fresh tabs never intercept arrows even when the profile is unknown', () => {
    assert.equal(
      shouldInterceptPtyHistoryArrow({
        data: '\x1b[A',
        shellProfileId: 'custom-shell',
        tabHistoryLength: 0,
      }),
      false,
    );
  });

  it('unknown shells with stored history still intercept so the fallback replace path can run', () => {
    assert.equal(
      shouldInterceptPtyHistoryArrow({
        data: '\x1b[A',
        shellProfileId: 'custom-shell',
        tabHistoryLength: 2,
      }),
      true,
    );
    assert.equal(
      shouldInterceptPtyHistoryArrow({
        data: 'a',
        shellProfileId: 'custom-shell',
        tabHistoryLength: 2,
      }),
      false,
    );
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
