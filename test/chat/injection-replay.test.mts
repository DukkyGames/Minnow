/**
 * Replaying first-turn prompt injections from persisted transcript rows.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  latestInjectionBodies,
  resolveInjectionReplay,
} from '../../src/chat/context/injection-replay.ts';
import type { Message, PromptInjectionKind } from '../../src/types.ts';

function injection(kind: PromptInjectionKind, body: string): Message {
  return { role: 'injection', kind, body, createdAt: 1 };
}

describe('latestInjectionBodies', () => {
  test('picks the last stored body per kind', () => {
    const history: Message[] = [
      { role: 'user', content: 'hi' },
      injection('code-map', 'map v1'),
      injection('context-documents', 'docs'),
      { role: 'assistant', content: 'ok' },
      injection('code-map', 'map v2'),
    ];
    assert.deepEqual(latestInjectionBodies(history), {
      'code-map': 'map v2',
      'context-documents': 'docs',
    });
  });

  test('ignores non-injection rows and blank bodies', () => {
    const history: Message[] = [
      { role: 'context', kind: 'compress', body: 'summary', createdAt: 1 } as Message,
      injection('brain-notes', '   '),
      { role: 'assistant', content: 'ok' },
    ];
    assert.deepEqual(latestInjectionBodies(history), {});
  });

  test('returns nothing for a transcript with no injections', () => {
    assert.deepEqual(latestInjectionBodies([{ role: 'user', content: 'hi' }]), {});
  });
});

describe('resolveInjectionReplay', () => {
  test('keeps every stored kind, including bodies that used to exceed the old 20% cap', () => {
    const notes = 'n'.repeat(8_000);
    const map = 'm'.repeat(36_000);
    const docs = 'd'.repeat(48_000);
    const history: Message[] = [
      { role: 'user', content: 'hi' },
      injection('context-documents', docs),
      injection('brain-notes', notes),
      injection('code-map', map),
    ];
    assert.deepEqual(resolveInjectionReplay(history), {
      'context-documents': docs,
      'brain-notes': notes,
      'code-map': map,
    });
  });

  test('prefers the untruncated snapshot over a transcript row cut at the storage cap', () => {
    const full = 'm'.repeat(40_000);
    const cut = `${full.slice(0, 24_000)}\n\n[… truncated for transcript storage]`;
    const history: Message[] = [
      { role: 'user', content: 'hi' },
      { role: 'injection', kind: 'code-map', body: cut, truncated: true, createdAt: 1 },
    ];
    assert.deepEqual(resolveInjectionReplay(history, { 'code-map': full }), {
      'code-map': full,
    });
  });

  test('detects a cut row from the marker when the flag is missing (pre-fix chats)', () => {
    const full = 'd'.repeat(30_000);
    const cut = `${full.slice(0, 24_000)}\n\n[… truncated for transcript storage]`;
    const history: Message[] = [injection('context-documents', cut)];
    assert.deepEqual(resolveInjectionReplay(history, { 'context-documents': full }), {
      'context-documents': full,
    });
  });

  test('keeps the truncated row when no snapshot survived', () => {
    const cut = `${'m'.repeat(24_000)}\n\n[… truncated for transcript storage]`;
    const history: Message[] = [injection('code-map', cut)];
    assert.deepEqual(resolveInjectionReplay(history, { 'brain-notes': 'notes' }), {
      'brain-notes': 'notes',
      'code-map': cut,
    });
  });

  test('a later untruncated row for the same kind wins over the snapshot again', () => {
    const cut = `${'m'.repeat(24_000)}\n\n[… truncated for transcript storage]`;
    const history: Message[] = [
      injection('code-map', cut),
      injection('code-map', 'map v2'),
    ];
    assert.deepEqual(resolveInjectionReplay(history, { 'code-map': 'snapshot' }), {
      'code-map': 'map v2',
    });
  });

  test('fills missing history kinds from the chat snapshot', () => {
    const history: Message[] = [
      { role: 'user', content: 'hi' },
      injection('brain-notes', 'notes from history'),
    ];
    assert.deepEqual(
      resolveInjectionReplay(history, {
        'brain-notes': 'stale notes',
        'code-map': 'src/foo.ts:1',
      }),
      {
        'brain-notes': 'notes from history',
        'code-map': 'src/foo.ts:1',
      },
    );
  });
});
