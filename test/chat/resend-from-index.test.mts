import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseSkillTagFromHistory } from '../../src/skills/history-content.ts';
import { sliceHistoryAtTurn } from '../../src/chat/history-truncate-core.ts';

describe('resend-from-index helpers', () => {
  test('parseSkillTagFromHistory extracts skill footer', () => {
    const parsed = parseSkillTagFromHistory('fix bug\n\n[skill: git-commit]');
    assert.equal(parsed.skillId, 'git-commit');
    assert.equal(parsed.displayText, 'fix bug');
  });

  test('parseSkillTagFromHistory coerces leaked ContentPart[] content', () => {
    const parsed = parseSkillTagFromHistory([
      { type: 'text', text: 'fix bug\n\n[skill: git-commit]' },
    ]);
    assert.equal(parsed.skillId, 'git-commit');
    assert.equal(parsed.displayText, 'fix bug');
  });

  test('sliceHistoryAtTurn before resend leaves user row at cut', () => {
    const history = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'again' },
      { role: 'assistant', content: 'sure' },
    ];
    const next = sliceHistoryAtTurn(history, 2, 'inclusive');
    assert.equal(next.length, 3);
    assert.equal(next[2].role, 'user');
    assert.equal(next[2].content, 'again');
  });
});
