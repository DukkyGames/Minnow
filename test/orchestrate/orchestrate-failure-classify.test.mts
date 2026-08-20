/**
 * MIN-285 Phase 2 — failure classification tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  classifyTaskFailure,
  inferStreamOutcome,
  isUnverifiedCompletion,
  resolveTaskChatStreamFailure,
} from '../../src/state/orchestrate-failure-classify.ts';
import type { BoardTask, Chat } from '../../src/types.ts';

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'c1',
    name: 'Builder',
    workspacePath: '/ws',
    modeId: 'orchestrate',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    ...overrides,
  };
}

function chatWithText(text: string): Chat {
  return makeChat({
    history: [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: text },
    ],
  });
}

function makeTask(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: 'W1-A',
    title: 'Test task',
    wave: 'W1',
    category: 'build',
    status: 'in_progress',
    ...overrides,
  };
}

// ── inferStreamOutcome ─────────────────────────────────────────────────────

describe('inferStreamOutcome', () => {
  test('completed when last assistant message is prose', () => {
    const chat = chatWithText('All done.');
    assert.equal(inferStreamOutcome(chat), 'completed');
  });

  test('failed when last assistant message contains stall marker', () => {
    const chat = chatWithText('Maximum tool turns reached. Cannot complete.');
    assert.equal(inferStreamOutcome(chat), 'failed');
  });

  test('stopped when assistant message has stopped flag', () => {
    const chat = makeChat({
      history: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: 'partial', stopped: true },
      ],
    });
    assert.equal(inferStreamOutcome(chat), 'stopped');
  });

  test('failed when no assistant messages', () => {
    assert.equal(inferStreamOutcome(makeChat()), 'failed');
  });

  test('failed when latest run status is failed', () => {
    // Only fields consumed by inferStreamOutcome are needed.
    const chat = makeChat({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runs: [{ status: 'failed', createdAt: 10 } as any],
    });
    assert.equal(inferStreamOutcome(chat), 'failed');
  });
});

// ── classifyTaskFailure — marker scan ─────────────────────────────────────

describe('classifyTaskFailure — text markers', () => {
  test('ECONNREFUSED → infra', () => {
    assert.equal(classifyTaskFailure(chatWithText('Error: ECONNREFUSED 127.0.0.1:5432')), 'infra');
  });

  test('user seed infra hypotheticals do not classify as infra', () => {
    const chat = makeChat({
      history: [
        {
          role: 'user',
          content:
            'If setup fails (DB connection refused, missing binary, port unavailable), report fail.',
        },
        { role: 'assistant', content: 'VERDICT: fail' },
      ],
    });
    assert.equal(classifyTaskFailure(chat, 'fail'), 'code');
  });

  test('Connection refused → infra', () => {
    assert.equal(classifyTaskFailure(chatWithText('Connection refused on port 5432')), 'infra');
  });

  test('EADDRINUSE → infra', () => {
    assert.equal(classifyTaskFailure(chatWithText('listen EADDRINUSE :::3000')), 'infra');
  });

  test('service-client command not found (psql) → infra', () => {
    assert.equal(classifyTaskFailure(chatWithText('bash: psql: command not found')), 'infra');
  });

  test('missing project toolchain bin (eslint, Windows phrasing) → code', () => {
    // Regression: eslint missing from devDependencies must route to the builder,
    // not be quarantined as infra. See MIN-285 follow-up.
    assert.equal(
      classifyTaskFailure(
        chatWithText(
          "> eslint .\n'eslint' is not recognized as an internal or external command,\noperable program or batch file.",
        ),
      ),
      'code',
    );
  });

  test('missing project toolchain bin (vite, posix phrasing) → code', () => {
    assert.equal(classifyTaskFailure(chatWithText('sh: vite: command not found')), 'code');
  });

  test('missing bin in npm-script context → code', () => {
    assert.equal(
      classifyTaskFailure(chatWithText('npm error Missing script binary\nnpm run build failed')),
      'code',
    );
  });

  test('unrecognised missing bin → infra (conservative)', () => {
    assert.equal(classifyTaskFailure(chatWithText('bash: somedaemon: command not found')), 'infra');
  });

  test("code error containing 'does not exist' no longer misclassified as infra", () => {
    assert.equal(
      classifyTaskFailure(chatWithText("Property 'foo' does not exist on type 'Bar'.")),
      'code',
    );
  });

  test('Cannot connect to the Docker daemon → infra', () => {
    assert.equal(
      classifyTaskFailure(chatWithText('Cannot connect to the Docker daemon at unix:///var/run/docker.sock')),
      'infra',
    );
  });

  test('psql: error → infra', () => {
    assert.equal(classifyTaskFailure(chatWithText('psql: error: connection to server failed')), 'infra');
  });

  test('Maximum tool turns reached → stall', () => {
    assert.equal(classifyTaskFailure(chatWithText('Maximum tool turns reached')), 'stall');
  });

  test('Could not complete this reply → stall', () => {
    assert.equal(classifyTaskFailure(chatWithText('Could not complete this reply')), 'stall');
  });

  test('context length exceeded is transient code failure, not stall', () => {
    assert.equal(
      classifyTaskFailure(
        chatWithText('Could not complete this reply: context length exceeded'),
      ),
      'code',
    );
    assert.equal(
      classifyTaskFailure(
        chatWithText(
          'Trying to generate tokens after context limit has been reached (n_ctx = 4096)',
        ),
      ),
      'code',
    );
    assert.equal(
      classifyTaskFailure(
        chatWithText(
          "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.",
        ),
      ),
      'code',
    );
  });

  test('clean prose → code', () => {
    assert.equal(classifyTaskFailure(chatWithText('TypeError: undefined is not a function')), 'code');
  });

  test('ambiguous mixed stall + infra signals — stall wins', () => {
    assert.equal(
      classifyTaskFailure(
        chatWithText('Maximum tool turns reached while connecting ECONNREFUSED 127.0.0.1:5432'),
      ),
      'stall',
    );
  });

  test('ambiguous mixed infra + code — infra scanned before code fallback', () => {
    assert.equal(
      classifyTaskFailure(
        chatWithText('ECONNREFUSED during npm run build\nTypeError: undefined is not a function'),
      ),
      'infra',
    );
  });
});

// ── classifyTaskFailure — structured signal ────────────────────────────────

describe('classifyTaskFailure — structured signal takes precedence', () => {
  test('env_blocked signal overrides prose → infra', () => {
    const chat = chatWithText('All tests passed!');
    assert.equal(classifyTaskFailure(chat, 'env_blocked'), 'infra');
  });

  test('env_blocked signal overrides stall markers → infra', () => {
    const chat = chatWithText('Maximum tool turns reached');
    assert.equal(classifyTaskFailure(chat, 'env_blocked'), 'infra');
  });

  test('failed signal falls through to text scan', () => {
    assert.equal(classifyTaskFailure(chatWithText('ECONNREFUSED'), 'failed'), 'infra');
    assert.equal(classifyTaskFailure(chatWithText('TypeError: x'), 'failed'), 'code');
  });

  test('no signal: stall detected before infra', () => {
    const chat = chatWithText('Maximum tool turns reached and ECONNREFUSED');
    assert.equal(classifyTaskFailure(chat), 'stall');
  });
});

// ── resolveTaskChatStreamFailure ───────────────────────────────────────────

describe('resolveTaskChatStreamFailure', () => {
  test('completed outcome → unknown category', () => {
    const { outcome, category } = resolveTaskChatStreamFailure(chatWithText('Done.'));
    assert.equal(outcome, 'completed');
    assert.equal(category, 'unknown');
  });

  test('failed + stall wins over infra when both present', () => {
    const chat = makeChat({
      history: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: 'Maximum tool turns reached. ECONNREFUSED port 5432' },
      ],
    });
    const { outcome, category } = resolveTaskChatStreamFailure(chat);
    assert.equal(outcome, 'failed');
    assert.equal(category, 'stall'); // stall scanned before infra
  });

  test('failed + stall marker → stall category', () => {
    const chat = makeChat({
      history: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: 'Maximum tool turns reached' },
      ],
    });
    const { outcome, category } = resolveTaskChatStreamFailure(chat);
    assert.equal(outcome, 'failed');
    assert.equal(category, 'stall');
  });
});

// ── isUnverifiedCompletion ─────────────────────────────────────────────────

describe('isUnverifiedCompletion (GAP-3)', () => {
  test('false when buildOutcome is set', () => {
    const task = makeTask({ buildOutcome: 'ok', testSpec: 'run npm test' });
    const chat = chatWithText('Done.');
    assert.equal(isUnverifiedCompletion(task, chat), false);
  });

  test('false when no testSpec', () => {
    const task = makeTask({ testSpec: undefined });
    const chat = chatWithText('Done.');
    assert.equal(isUnverifiedCompletion(task, chat), false);
  });

  test('false when outcome is failed', () => {
    const task = makeTask({ testSpec: 'run npm test' });
    const chat = makeChat(); // no history → failed
    assert.equal(isUnverifiedCompletion(task, chat), false);
  });

  test('true when no buildOutcome + testSpec + prose completed', () => {
    const task = makeTask({ testSpec: 'run npm test' });
    const chat = chatWithText('I finished implementing everything.');
    assert.equal(isUnverifiedCompletion(task, chat), true);
  });
});
