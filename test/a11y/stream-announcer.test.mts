/**
 * Throttled streaming announcements for screen readers.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  announceStreamingProse,
  beginStreamAnnouncer,
  cancelStreamAnnouncer,
  completeStreamAnnouncer,
} from '../../src/ui/a11y/stream-announcer.ts';

describe('stream-announcer', () => {
  let window: Window;

  afterEach(() => {
    cancelStreamAnnouncer();
    window?.document.body.replaceChildren();
    window?.close();
  });

  test('throttles repeated prose announcements', () => {
    window = new Window();
    const wrap = window.document.createElement('div');
    window.document.body.appendChild(wrap);
    beginStreamAnnouncer(wrap);

    announceStreamingProse('First chunk of prose');
    const announcer = window.document.getElementById('chatStreamAnnouncer');
    assert.ok(announcer);
    assert.equal(announcer?.textContent, 'First chunk of prose');

    announceStreamingProse('Second chunk arrives quickly');
    assert.equal(announcer?.textContent, 'First chunk of prose');

    completeStreamAnnouncer('Final response text');
    assert.match(announcer?.textContent ?? '', /^Response complete\./);
    assert.equal(wrap.getAttribute('aria-busy'), null);
  });

  test('cancel clears busy state without completion message', () => {
    window = new Window();
    const wrap = window.document.createElement('div');
    window.document.body.appendChild(wrap);
    beginStreamAnnouncer(wrap);
    assert.equal(wrap.getAttribute('aria-busy'), 'true');
    cancelStreamAnnouncer();
    assert.equal(wrap.getAttribute('aria-busy'), null);
  });
});
