import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistoryClearInput,
  buildHistoryReplaceInput,
  resolveHistoryNavigation,
} from '../../src/ui/terminal-history-nav.ts';

describe('terminal-history-nav', () => {
  it('buildHistoryReplaceInput clears current buffer then writes next line', () => {
    assert.equal(
      buildHistoryReplaceInput('abc', 'ls -la'),
      '\x7f\x7f\x7fls -la',
    );
    assert.equal(buildHistoryReplaceInput('', 'pwd'), 'pwd');
  });

  it('buildHistoryClearInput sends backspaces for current buffer', () => {
    assert.equal(buildHistoryClearInput('hi'), '\x7f\x7f');
    assert.equal(buildHistoryClearInput(''), '');
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
