import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  MAX_LOOP_PROMPT_CHARS,
  MIN_LOOP_INTERVAL_MS,
  isLoopSlashCommand,
  isNestedLoopOrGoalPrompt,
  parseLoopIntervalToken,
  parseLoopSlashInput,
} from '../../src/chat/loop/parse-command.ts';

describe('parseLoopSlashInput', () => {
  test('returns null for non-loop commands', () => {
    assert.equal(parseLoopSlashInput('/git-commit fix'), null);
    assert.equal(parseLoopSlashInput('hello'), null);
    assert.equal(parseLoopSlashInput('/goal clear'), null);
  });

  test('bare /loop arms maintenance auto loop', () => {
    assert.deepEqual(parseLoopSlashInput('/loop'), {
      kind: 'arm',
      loopKind: 'auto',
      promptText: '',
    });
    assert.deepEqual(parseLoopSlashInput('  /loop  '), {
      kind: 'arm',
      loopKind: 'auto',
      promptText: '',
    });
  });

  test('interval forms with prompt', () => {
    assert.deepEqual(parseLoopSlashInput('/loop 5m check deploy'), {
      kind: 'arm',
      loopKind: 'interval',
      intervalMs: 5 * 60_000,
      promptText: 'check deploy',
    });
    assert.deepEqual(parseLoopSlashInput('/loop 2h /simplify'), {
      kind: 'arm',
      loopKind: 'interval',
      intervalMs: 2 * 3_600_000,
      promptText: '/simplify',
    });
    assert.deepEqual(parseLoopSlashInput('/loop 1d status'), {
      kind: 'arm',
      loopKind: 'interval',
      intervalMs: 86_400_000,
      promptText: 'status',
    });
  });

  test('sub-minute intervals round up to 1m', () => {
    assert.equal(parseLoopIntervalToken('30s'), MIN_LOOP_INTERVAL_MS);
    assert.equal(parseLoopIntervalToken('1s'), MIN_LOOP_INTERVAL_MS);
    const parsed = parseLoopSlashInput('/loop 15s say hi');
    assert.equal(parsed?.kind, 'arm');
    if (parsed?.kind === 'arm') {
      assert.equal(parsed.intervalMs, MIN_LOOP_INTERVAL_MS);
      assert.equal(parsed.promptText, 'say hi');
    }
  });

  test('auto-paced prompt without interval', () => {
    assert.deepEqual(parseLoopSlashInput('/loop check whether package.json changed'), {
      kind: 'arm',
      loopKind: 'auto',
      promptText: 'check whether package.json changed',
    });
  });

  test('list and status subcommands', () => {
    assert.deepEqual(parseLoopSlashInput('/loop list'), { kind: 'list' });
    assert.deepEqual(parseLoopSlashInput('/loop status'), { kind: 'list' });
  });

  test('stop aliases with optional id or all', () => {
    for (const alias of ['stop', 'clear', 'off', 'cancel']) {
      assert.deepEqual(parseLoopSlashInput(`/loop ${alias}`), {
        kind: 'stop',
        target: 'all',
      });
      assert.deepEqual(parseLoopSlashInput(`/loop ${alias} all`), {
        kind: 'stop',
        target: 'all',
      });
      assert.deepEqual(parseLoopSlashInput(`/loop ${alias} 2`), {
        kind: 'stop',
        target: 2,
      });
    }
  });

  test('invalid stop target yields usage error', () => {
    assert.deepEqual(parseLoopSlashInput('/loop stop xyz'), {
      kind: 'invalid',
      message: 'Usage: /loop stop [n | all]',
    });
  });

  test('truncates very long prompts', () => {
    const long = 'x'.repeat(MAX_LOOP_PROMPT_CHARS + 50);
    const result = parseLoopSlashInput(`/loop ${long}`);
    assert.equal(result?.kind, 'arm');
    if (result?.kind === 'arm') {
      assert.equal(result.promptText.length, MAX_LOOP_PROMPT_CHARS);
    }
  });

  test('isLoopSlashCommand detects token', () => {
    assert.equal(isLoopSlashCommand('/loop 5m hi'), true);
    assert.equal(isLoopSlashCommand('please /loop later'), true);
    assert.equal(isLoopSlashCommand('/loopy'), false);
  });

  test('nested /loop or /goal prompts are detected', () => {
    assert.equal(isNestedLoopOrGoalPrompt('/loop again'), true);
    assert.equal(isNestedLoopOrGoalPrompt('/goal done'), true);
    assert.equal(isNestedLoopOrGoalPrompt('/simplify'), false);
    assert.equal(isNestedLoopOrGoalPrompt('check /loop.md'), false);
  });
});
