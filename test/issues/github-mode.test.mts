/**
 * Stored Link + push migrates to Off and is rewritten so Settings cannot bounce.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  getIssuesGithubMode,
  resetIssuesGithubForTests,
  setIssuesGithubMode,
} from '../../src/state/issues-github.ts';

const KEY = 'minnow.issues.github.mode';

const memory = new Map<string, string>();
const storage: Storage = {
  getItem(key: string) {
    return memory.has(key) ? memory.get(key)! : null;
  },
  setItem(key: string, value: string) {
    memory.set(key, String(value));
  },
  removeItem(key: string) {
    memory.delete(key);
  },
  clear() {
    memory.clear();
  },
  key() {
    return null;
  },
  get length() {
    return memory.size;
  },
};

describe('GitHub sync mode storage', () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  beforeEach(() => {
    memory.clear();
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
    resetIssuesGithubForTests();
  });

  afterEach(() => {
    resetIssuesGithubForTests();
    if (previousStorage) {
      Object.defineProperty(globalThis, 'localStorage', previousStorage);
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  test('stored link is rewritten to off on read', () => {
    memory.set(KEY, 'link');
    assert.equal(getIssuesGithubMode(), 'off');
    assert.equal(memory.get(KEY), 'off');
  });

  test('setIssuesGithubMode coerces retired link to off', () => {
    setIssuesGithubMode('link' as 'off');
    assert.equal(getIssuesGithubMode(), 'off');
    assert.equal(memory.get(KEY), 'off');
  });
});
