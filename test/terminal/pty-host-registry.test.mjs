/**
 * PTY registry slot accounting (no live spawn required).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('pty-host session cap accounting', () => {
  test('active count ignores exited sessions after prune', () => {
    const sessions = new Map();
    sessions.set('a', { exited: false });
    sessions.set('b', { exited: true });
    sessions.set('c', { exited: false });

    const prune = () => {
      for (const [id, session] of sessions) {
        if (session.exited) sessions.delete(id);
      }
    };
    const countActive = () => {
      let n = 0;
      for (const session of sessions.values()) {
        if (!session.exited) n += 1;
      }
      return n;
    };

    assert.equal(countActive(), 2);
    prune();
    assert.equal(sessions.size, 2);
    assert.equal(countActive(), 2);
    sessions.set('d', { exited: true });
    sessions.set('e', { exited: true });
    prune();
    assert.equal(sessions.size, 2);
    assert.equal(countActive(), 2);
  });
});
