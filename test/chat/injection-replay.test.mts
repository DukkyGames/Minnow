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
