/**
 * Replaying first-turn prompt injections from persisted transcript rows.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  capInjectionReplay,
  INJECTION_REPLAY_FALLBACK_TOKEN_CAP,
  latestInjectionBodies,
  resolveInjectionReplay,
  resolveInjectionReplayTokenCap,
} from '../../src/chat/context/injection-replay.ts';
import type { Message, PromptInjectionKind } from '../../src/types.ts';

function injection(kind: PromptInjectionKind, body: string): Message {
  return { role: 'injection', kind, body, createdAt: 1 };
}

/** Text that estimates to roughly `tokens` (estimator is chars ÷ 4). */
function bodyOfTokens(tokens: number): string {
  return 'x'.repeat(tokens * 4);
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

describe('resolveInjectionReplayTokenCap', () => {
  test('uses a fifth of the model window', () => {
    assert.equal(resolveInjectionReplayTokenCap(100_000), 20_000);
  });

  test('falls back to a fixed cap when the window is unknown', () => {
    assert.equal(
      resolveInjectionReplayTokenCap(null),
      INJECTION_REPLAY_FALLBACK_TOKEN_CAP,
    );
    assert.equal(
      resolveInjectionReplayTokenCap(undefined),
      INJECTION_REPLAY_FALLBACK_TOKEN_CAP,
    );
    assert.equal(resolveInjectionReplayTokenCap(0), INJECTION_REPLAY_FALLBACK_TOKEN_CAP);
  });
});

describe('capInjectionReplay', () => {
  test('keeps everything when it fits', () => {
    const bodies = {
      'brain-notes': 'notes',
      'code-map': 'map',
      'context-documents': 'docs',
    };
    assert.deepEqual(capInjectionReplay(bodies, { modelContextLimit: 100_000 }), bodies);
  });

  test('fills in priority order: context documents, then brain notes, then code map', () => {
    // Cap is 1,000 tokens; docs (600) + notes (300) fit, the map (600) does not.
    const capped = capInjectionReplay(
      {
        'context-documents': bodyOfTokens(600),
        'brain-notes': bodyOfTokens(300),
        'code-map': bodyOfTokens(600),
      },
      { modelContextLimit: 5_000 },
    );
    assert.deepEqual(Object.keys(capped).sort(), ['brain-notes', 'context-documents']);
  });

  test('drops a kind whole rather than truncating it', () => {
    const capped = capInjectionReplay(
      { 'code-map': bodyOfTokens(5_000) },
      { modelContextLimit: 5_000 },
    );
    assert.deepEqual(capped, {});
  });

  test('a later kind still fits after an oversized one is skipped', () => {
    const capped = capInjectionReplay(
      {
        'context-documents': bodyOfTokens(2_000),
        'code-map': bodyOfTokens(10),
      },
      { modelContextLimit: 5_000 },
    );
    assert.deepEqual(Object.keys(capped), ['code-map']);
  });
});

describe('resolveInjectionReplay', () => {
  test('reads the transcript and applies the cap in one pass', () => {
    const history: Message[] = [
      { role: 'user', content: 'hi' },
      injection('context-documents', 'docs body'),
      injection('code-map', bodyOfTokens(10_000)),
    ];
    const replay = resolveInjectionReplay(history, { modelContextLimit: 8_000 });
    assert.deepEqual(replay, { 'context-documents': 'docs body' });
  });
});
