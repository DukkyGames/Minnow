/**
 * Heuristic detection for prose that should use ask_question.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { looksLikeProseStructuredQuestion } from '../../src/tools/prose-question-detect.ts';

describe('looksLikeProseStructuredQuestion', () => {
  test('detects numbered options with a question', () => {
    const text = `Which scope should we target first?

1. MVP — auth and dashboard only
2. Full product — all modules in the backlog
3. Defer non-critical features`;

    assert.equal(looksLikeProseStructuredQuestion(text), true);
  });

  test('detects lettered inline options with choice phrase', () => {
    const text =
      'Please choose one path forward: A) refactor the API layer first, B) ship UI fixes first, C) pause until design review.';
    assert.equal(looksLikeProseStructuredQuestion(text), true);
  });

  test('ignores procedural numbered steps without a choice question', () => {
    const text = `Here is how to run the migration:

1. Stop the dev server
2. Run npm run migrate
3. Restart and verify logs`;

    assert.equal(looksLikeProseStructuredQuestion(text), false);
  });

  test('ignores short clarifications', () => {
    assert.equal(looksLikeProseStructuredQuestion('Which file should I open?'), false);
  });

  test('ignores descriptive dash bullets with an echoed user question', () => {
    const text = `The user is asking what is this?
- Left side: Character sprites
- Middle sections: Various items and weapons
- Right side: More items and potions
This looks like a sprite sheet from a 2D pixel art game.`;

    assert.equal(looksLikeProseStructuredQuestion(text), false);
  });
});
