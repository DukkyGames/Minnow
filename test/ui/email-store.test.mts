/**
 * Optimistic mail store, virtual-list windowing, recipient tokenizing (MIN-353).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

import { createMailStore } from '../../src/ui/email/email-store';
import { computeWindow, OVERSCAN_ROWS } from '../../src/ui/email/email-virtual-list';
import {
  applyRecipientChoice,
  splitRecipients,
} from '../../src/ui/email/email-recipient-field';
import { isTypingTarget, MAIL_SHORTCUTS } from '../../src/ui/email/email-keyboard';
import {
  formatParticipants,
  messageCountLabel,
  participantLabel,
  toConversationRow,
} from '../../src/ui/email/email-conversation-row';
import {
  ACCOUNT_DOT_CLASSES,
  accountColorIndex,
  mergeByDate,
  type UnifiedMessage,
} from '../../src/ui/email/email-unified';
import type { EmailMessage } from '../../src/email/client';

function message(id: string, overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id,
    uid: id,
    threadId: `thread-${id}`,
    folder: 'INBOX',
    from: 'Alice <alice@example.com>',
    to: ['me@example.com'],
    subject: `Subject ${id}`,
    date: '2026-07-01T10:00:00.000Z',
    bodyPreview: 'preview',
    hasAttachments: false,
    flags: { seen: false, flagged: false },
    ...overrides,
  };
}

/** A promise plus the handles to settle it later. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('optimistic mail store', () => {
  test('applies a change before the request settles', async () => {
    const store = createMailStore();
    store.replace([message('a')], 1);

    const gate = deferred<void>();
    const pending = store.mutate('a', { flags: { seen: false, flagged: true } }, () => gate.promise);

    // The point of the whole exercise: the row is already starred.
    assert.equal(store.get('a')?.flags?.flagged, true);
    assert.equal(store.pendingCount(), 1);

    gate.resolve();
    assert.equal(await pending, true);
    assert.equal(store.get('a')?.flags?.flagged, true);
    assert.equal(store.pendingCount(), 0);
  });

  test('rolls back and reports when the request fails', async () => {
    const errors: string[] = [];
    const store = createMailStore({ onError: (msg) => errors.push(msg) });
    store.replace([message('a')], 1);

    const ok = await store.mutate('a', { flags: { seen: false, flagged: true } }, () =>
      Promise.reject(new Error('IMAP said no')),
    );

    assert.equal(ok, false);
    assert.equal(store.get('a')?.flags?.flagged, false, 'the star is taken back');
    assert.deepEqual(errors, ['IMAP said no']);
    assert.equal(store.pendingCount(), 0);
  });

  test('removes a row immediately and restores it on failure', async () => {
    const store = createMailStore();
    store.replace([message('a'), message('b'), message('c')], 3);

    const ok = await store.remove('b', () => Promise.reject(new Error('nope')));

    assert.equal(ok, false);
    assert.deepEqual(
      store.getState().messages.map((row) => row.id),
      ['a', 'b', 'c'],
      'the row returns to its original position',
    );
    assert.equal(store.getState().total, 3);
  });

  test('a successful removal drops the row and the count', async () => {
    const store = createMailStore();
    store.replace([message('a'), message('b')], 2);

    assert.equal(await store.remove('a', () => Promise.resolve()), true);
    assert.deepEqual(store.getState().messages.map((row) => row.id), ['b']);
    assert.equal(store.getState().total, 1);
  });

  test('notifies subscribers on every change', async () => {
    const store = createMailStore();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.replace([message('a')], 1);
    await store.mutate('a', { flags: { seen: true, flagged: false } }, () => Promise.resolve());

    assert.ok(notifications >= 2, 'replace and mutate both announce');
  });

  test('a server flag echo does not clobber an in-flight local change', async () => {
    const store = createMailStore();
    store.replace([message('a')], 1);

    const gate = deferred<void>();
    const pending = store.mutate('a', { flags: { seen: false, flagged: true } }, () => gate.promise);

    // The server is still reporting the old state; the user's click wins.
    store.applyServerFlags('a', { seen: false, flagged: false });
    assert.equal(store.get('a')?.flags?.flagged, true);

    gate.resolve();
    await pending;

    // Once settled, a genuine server change does apply.
    store.applyServerFlags('a', { seen: true, flagged: true });
    assert.equal(store.get('a')?.flags?.seen, true);
  });

  test('mutating a row that is gone is a no-op, not a crash', async () => {
    const store = createMailStore();
    store.replace([message('a')], 1);
    assert.equal(await store.mutate('missing', { subject: 'x' }, () => Promise.resolve()), false);
    assert.equal(await store.remove('missing', () => Promise.resolve()), false);
  });
});

describe('virtual list windowing', () => {
  test('renders only the viewport plus overscan', () => {
    const window_ = computeWindow({
      scrollTop: 0,
      viewportHeight: 640,
      rowHeight: 64,
      itemCount: 10_000,
    });

    assert.equal(window_.start, 0);
    // 10 visible + 1 partial + overscan.
    assert.equal(window_.end, 11 + OVERSCAN_ROWS);
    assert.equal(window_.padTop, 0);
    assert.equal(window_.padBottom, (10_000 - window_.end) * 64);
  });

  test('spacers always sum to the full scroll height', () => {
    const rowHeight = 64;
    const itemCount = 5_000;
    for (const scrollTop of [0, 640, 64_000, 319_360]) {
      const window_ = computeWindow({ scrollTop, viewportHeight: 640, rowHeight, itemCount });
      const rendered = (window_.end - window_.start) * rowHeight;
      assert.equal(
        window_.padTop + rendered + window_.padBottom,
        itemCount * rowHeight,
        `scrollbar stays honest at scrollTop=${scrollTop}`,
      );
    }
  });

  test('scrolled into the middle, the window follows', () => {
    const window_ = computeWindow({
      scrollTop: 64 * 500,
      viewportHeight: 640,
      rowHeight: 64,
      itemCount: 1_000,
    });

    assert.equal(window_.start, 500 - OVERSCAN_ROWS);
    assert.ok(window_.start > 0 && window_.end < 1_000);
  });

  test('never runs past the ends', () => {
    const atTop = computeWindow({
      scrollTop: -50,
      viewportHeight: 640,
      rowHeight: 64,
      itemCount: 3,
    });
    assert.equal(atTop.start, 0);
    assert.equal(atTop.end, 3);
    assert.equal(atTop.padBottom, 0);

    const past = computeWindow({
      scrollTop: 999_999,
      viewportHeight: 640,
      rowHeight: 64,
      itemCount: 3,
    });
    assert.equal(past.end, 3);
  });

  test('an empty list renders nothing', () => {
    assert.deepEqual(
      computeWindow({ scrollTop: 0, viewportHeight: 640, rowHeight: 64, itemCount: 0 }),
      { start: 0, end: 0, padTop: 0, padBottom: 0 },
    );
  });
});

describe('recipient tokenizing', () => {
  test('completes only the token under the caret', () => {
    assert.deepEqual(splitRecipients('alice@x.com, bo'), {
      committed: ['alice@x.com'],
      active: 'bo',
    });
    assert.deepEqual(splitRecipients('bo'), { committed: [], active: 'bo' });
    assert.deepEqual(splitRecipients('alice@x.com, '), {
      committed: ['alice@x.com'],
      active: '',
    });
  });

  test('a choice replaces the partial token and opens the next', () => {
    assert.equal(
      applyRecipientChoice('alice@x.com, bo', 'Bob <bob@x.com>'),
      'alice@x.com, Bob <bob@x.com>, ',
    );
    assert.equal(applyRecipientChoice('bo', 'Bob <bob@x.com>'), 'Bob <bob@x.com>, ');
  });
});

describe('keyboard model', () => {
  test('documents every binding it advertises', () => {
    assert.ok(MAIL_SHORTCUTS.length >= 12);
    for (const row of MAIL_SHORTCUTS) {
      assert.ok(row.keys.trim(), 'every row names a key');
      assert.ok(row.label.trim(), 'every row explains itself');
    }
  });

  test('suppresses shortcuts while a text field has focus', () => {
    const win = new Window();
    globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
    const doc = win.document;

    try {
      // Typing "e" in any of these must not archive the thread behind them.
      assert.equal(isTypingTarget(doc.createElement('input') as unknown as EventTarget), true);
      assert.equal(isTypingTarget(doc.createElement('textarea') as unknown as EventTarget), true);
      assert.equal(isTypingTarget(doc.createElement('select') as unknown as EventTarget), true);

      const editable = doc.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      assert.equal(
        isTypingTarget(editable as unknown as EventTarget),
        true,
        'the compose body is contenteditable, not a textarea',
      );

      // An ordinary row is not a typing target, so shortcuts do fire there.
      assert.equal(isTypingTarget(doc.createElement('div') as unknown as EventTarget), false);
      assert.equal(isTypingTarget(null), false);
    } finally {
      win.close();
      delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
    }
  });
});

describe('conversation rollups', () => {
  test('names the people, first name only, and folds the rest', () => {
    assert.equal(formatParticipants(['Alice Smith <a@x.com>']), 'Alice');
    assert.equal(
      formatParticipants(['Alice Smith <a@x.com>', 'Bob Jones <b@x.com>']),
      'Alice, Bob',
    );
    assert.equal(
      formatParticipants([
        'Alice <a@x.com>',
        'Bob <b@x.com>',
        'Carla <c@x.com>',
        'Dan <d@x.com>',
        'Eve <e@x.com>',
      ]),
      'Alice, Bob, Carla +2',
      'a long thread must not overflow the row',
    );
  });

  test('falls back to the local part of a bare address', () => {
    assert.equal(participantLabel('someone@example.com'), 'someone');
    assert.equal(participantLabel('"Quoted Name" <q@x.com>'), 'Quoted');
    assert.equal(participantLabel(''), '');
  });

  test('deduplicates a person who appears repeatedly', () => {
    assert.equal(
      formatParticipants(['Alice <a@x.com>', 'Alice <a@x.com>', 'Bob <b@x.com>']),
      'Alice, Bob',
    );
  });

  test('handles a thread with no participants at all', () => {
    assert.equal(formatParticipants([]), '(unknown)');
  });

  test('shows a count chip only for real conversations', () => {
    assert.equal(messageCountLabel(1), '', 'a single message needs no chip');
    assert.equal(messageCountLabel(0), '');
    assert.equal(messageCountLabel(3), '×3');
  });

  test('shapes a rollup into everything the row paints', () => {
    const model = toConversationRow({
      threadId: '<t@x>',
      subject: '  Quarterly contract  ',
      participants: ['Alice Smith <a@x.com>', 'Bob <b@x.com>'],
      messageCount: 4,
      unreadCount: 2,
      flagged: true,
      hasAttachments: true,
      lastDate: '2026-07-05T10:00:00.000Z',
      folders: ['INBOX'],
      snippet: 'Please review',
      summary: null,
    });

    assert.equal(model.participants, 'Alice, Bob');
    assert.equal(model.countLabel, '×4');
    assert.equal(model.subject, 'Quarterly contract');
    assert.equal(model.unread, true);
    assert.equal(model.flagged, true);
    assert.equal(model.hasAttachments, true);
  });

  test('an empty subject reads as (no subject), not blank', () => {
    const model = toConversationRow({
      threadId: '<t@x>',
      subject: '   ',
      participants: [],
      messageCount: 1,
      unreadCount: 0,
      flagged: false,
      hasAttachments: false,
      lastDate: '',
      folders: [],
      snippet: '',
      summary: null,
    });

    assert.equal(model.subject, '(no subject)');
    assert.equal(model.unread, false);
  });
});

describe('unified inbox', () => {
  const accounts = [
    { id: 'a1', label: 'Work' },
    { id: 'a2', label: 'Personal' },
    { id: 'a3', label: 'Archive' },
  ] as unknown as Parameters<typeof accountColorIndex>[0];

  function unified(
    id: string,
    date: string,
    accountId: string,
  ): UnifiedMessage {
    return {
      ...message(id, { date }),
      accountId,
      accountLabel: accountId,
      accountColorIndex: 0,
    };
  }

  test('merges accounts into one newest-first list', () => {
    const merged = mergeByDate(
      [
        [unified('a', '2026-07-01T10:00:00.000Z', 'a1'), unified('b', '2026-07-03T10:00:00.000Z', 'a1')],
        [unified('c', '2026-07-02T10:00:00.000Z', 'a2'), unified('d', '2026-07-04T10:00:00.000Z', 'a2')],
      ],
      50,
    );

    assert.deepEqual(merged.map((row) => row.id), ['d', 'b', 'c', 'a']);
  });

  test('caps the merged list at the requested limit', () => {
    const merged = mergeByDate(
      [
        [unified('a', '2026-07-01T10:00:00.000Z', 'a1')],
        [unified('b', '2026-07-02T10:00:00.000Z', 'a2')],
        [unified('c', '2026-07-03T10:00:00.000Z', 'a2')],
      ],
      2,
    );

    assert.equal(merged.length, 2);
    assert.deepEqual(merged.map((row) => row.id), ['c', 'b'], 'the newest survive the cap');
  });

  test('an unparseable date sorts last rather than throwing', () => {
    const merged = mergeByDate(
      [
        [unified('bad', 'not-a-date', 'a1')],
        [unified('good', '2026-07-02T10:00:00.000Z', 'a2')],
      ],
      50,
    );

    assert.equal(merged[0].id, 'good');
    assert.equal(merged.length, 2, 'the bad row is kept, just ordered last');
  });

  test('each account gets a stable colour slot that wraps', () => {
    assert.equal(accountColorIndex(accounts, 'a1'), 0);
    assert.equal(accountColorIndex(accounts, 'a2'), 1);
    assert.equal(accountColorIndex(accounts, 'a3'), 2);
    // An unknown account falls back rather than indexing out of range.
    assert.equal(accountColorIndex(accounts, 'missing'), 0);
  });

  test('the colour slot never runs past the palette', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `acct-${i}` })) as unknown as Parameters<
      typeof accountColorIndex
    >[0];

    for (let i = 0; i < 12; i += 1) {
      const index = accountColorIndex(many, `acct-${i}`);
      assert.ok(
        index >= 0 && index < ACCOUNT_DOT_CLASSES.length,
        `slot ${index} is inside the palette`,
      );
    }
  });
});
