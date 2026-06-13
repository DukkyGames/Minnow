import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isEchoSeed,
  isNavigationOnlyCodeRequest,
  sanitizeConciergeSeed,
  stripSeedFiller,
} from '../../src/os/concierge-seed.ts';

describe('isNavigationOnlyCodeRequest', () => {
  test('detects workspace open without a task', () => {
    assert.equal(isNavigationOnlyCodeRequest("Let's code in our finance app"), true);
    assert.equal(isNavigationOnlyCodeRequest('open my finance app workspace'), true);
  });

  test('does not flag actionable tasks', () => {
    assert.equal(isNavigationOnlyCodeRequest('fix bugs in our finance app'), false);
    assert.equal(isNavigationOnlyCodeRequest('implement login in finance app'), false);
  });
});

describe('isEchoSeed', () => {
  test('detects near-identical seed and user text', () => {
    assert.equal(
      isEchoSeed("Let's code in our finance app", "Let's code in our finance app"),
      true,
    );
    assert.equal(
      isEchoSeed("Let's code in our finance app", 'Code in our finance app'),
      true,
    );
  });
});

describe('stripSeedFiller', () => {
  test('removes leading filler phrases', () => {
    assert.equal(stripSeedFiller("Let's research apple stock"), 'research apple stock');
  });
});

describe('sanitizeConciergeSeed', () => {
  test('clears seed and autoRun for navigation-only Code opens', () => {
    const result = sanitizeConciergeSeed({
      userText: "Let's code in our finance app",
      seed: "Let's code in our finance app",
      appId: 'code',
      autoRun: true,
    });
    assert.equal(result.seed, undefined);
    assert.equal(result.autoRun, false);
  });

  test('keeps actionable code tasks with autoRun', () => {
    const result = sanitizeConciergeSeed({
      userText: 'Find bugs in my finance app',
      seed: 'Find bugs in the finance app',
      appId: 'code',
      autoRun: true,
    });
    assert.equal(result.seed, 'Find bugs in the finance app');
    assert.equal(result.autoRun, true);
  });

  test('does not clear non-echo code seed when autoRun is false', () => {
    const result = sanitizeConciergeSeed({
      userText: 'Add a dark mode toggle to settings',
      seed: 'Implement dark mode toggle in settings page',
      appId: 'code',
      autoRun: false,
    });
    assert.equal(result.seed, 'Implement dark mode toggle in settings page');
    assert.equal(result.autoRun, false);
  });
});
