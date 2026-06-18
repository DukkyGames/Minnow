/**
 * Archive bundle validation (MIN-139).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { validateArchiveBundle } from '../../../src/chat/archive/bundle-validate.ts';
import type { ApiMessage } from '../../../src/types.ts';

describe('validateArchiveBundle', () => {
  test('accepts anchored facts', () => {
    const turns: ApiMessage[] = [{ role: 'user', content: 'We chose JWT for sessions.' }];
    const result = validateArchiveBundle(
      {
        title: 't',
        facts: [
          {
            statement: 'JWT for sessions',
            sourceQuote: 'We chose JWT for sessions.',
            sourceTurnIndex: 0,
          },
        ],
        entities: [{ slug: 'auth', title: 'Auth' }],
      },
      turns,
      [0],
    );
    assert.equal(result.ok, true);
    assert.equal(result.facts.length, 1);
  });

  test('rejects non-substring quote', () => {
    const turns: ApiMessage[] = [{ role: 'user', content: 'hello' }];
    const result = validateArchiveBundle(
      {
        title: 't',
        facts: [
          {
            statement: 'wrong',
            sourceQuote: 'not in source',
            sourceTurnIndex: 0,
          },
        ],
        entities: [],
      },
      turns,
      [0],
    );
    assert.equal(result.ok, false);
  });

  test('rejects zero facts', () => {
    const turns: ApiMessage[] = [{ role: 'user', content: 'hello' }];
    const result = validateArchiveBundle(
      { title: 't', facts: [], entities: [] },
      turns,
      [0],
    );
    assert.equal(result.ok, false);
  });
});
