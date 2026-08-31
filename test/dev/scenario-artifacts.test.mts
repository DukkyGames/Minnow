/**
 * Scenario run artifacts (redaction + schema).
 *
 * Moved from `test/orchestrate/` in MIN-716. Still used by
 * `server/orchestrate/board-testing/` Settings runs.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  parseScenarioIterationArtifact,
  parseScenarioRunManifest,
  sanitizeArtifactValue,
  sanitizeFakeModelRequest,
  sanitizeScenarioArtifactBundle,
} from '../../src/dev/orchestrate-scenarios/index.ts';

const manifest = {
  schemaVersion: 1,
  runId: 'run-001',
  scenarioId: 'happy.quick',
  seed: 'happy.quick.v1',
  startedAt: '2026-07-28T12:00:00.000Z',
  iterationCount: 1,
};

const iteration = {
  iteration: 1,
  outcome: 'passed',
  startedAt: '2026-07-28T12:00:00.000Z',
  finishedAt: '2026-07-28T12:00:02.000Z',
  durationMs: 2_000,
  violations: [],
};

describe('orchestrate scenario artifacts', () => {
  test('strictly validates manifest and iteration records', () => {
    assert.deepEqual(parseScenarioRunManifest(manifest), manifest);
    assert.deepEqual(parseScenarioIterationArtifact(iteration), iteration);
    assert.throws(
      () => parseScenarioRunManifest({ ...manifest, headers: {} }),
      /manifest\.headers is not allowed/,
    );
    assert.throws(
      () => parseScenarioIterationArtifact({ ...iteration, outcome: 'maybe' }),
      /iteration\.outcome must be one of/,
    );
  });

  test('recursively redacts secrets and deterministically bounds unrestricted content', () => {
    const sanitized = sanitizeArtifactValue(
      {
        z: 'last',
        Authorization: 'Bearer private',
        nested: {
          api_key: 'private-key',
          content: 'x'.repeat(2_000),
        },
      },
      { maxStringLength: 1_500 },
    ) as Record<string, unknown>;
    assert.equal(sanitized.Authorization, '[REDACTED]');
    assert.equal(
      (sanitized.nested as Record<string, unknown>).api_key,
      '[REDACTED]',
    );
    const content = (sanitized.nested as Record<string, unknown>).content as string;
    assert.equal(content.startsWith('x'.repeat(1_024)), true);
    assert.match(content, /\[TRUNCATED\]$/);
    assert.deepEqual(Object.keys(sanitized), ['Authorization', 'nested', 'z']);
  });

  test('keeps replay context while removing headers and URL query values', () => {
    const sanitized = sanitizeFakeModelRequest({
      at: 123,
      method: 'post',
      url: 'http://127.0.0.1:18765/v1/chat/completions?api_key=private#fragment',
      headers: { authorization: 'Bearer private' },
      context: { role: 'builder', taskId: 'W1-A', nth: 0, ignored: true },
      body: {
        model: 'fake-board-model',
        accessToken: 'private',
        messages: [{ role: 'user', content: 'Execute this task.' }],
      },
    });
    assert.deepEqual(sanitized, {
      at: 123,
      method: 'POST',
      url: '/v1/chat/completions?[REDACTED]',
      context: { role: 'builder', taskId: 'W1-A', nth: 0 },
      body: {
        accessToken: '[REDACTED]',
        messages: [{ content: 'Execute this task.', role: 'user' }],
        model: 'fake-board-model',
      },
    });
    assert.equal('headers' in sanitized, false);
  });

  test('builds a fully sanitized filesystem-neutral artifact bundle', () => {
    const bundle = sanitizeScenarioArtifactBundle({
      manifest,
      iterations: [iteration],
      boardLog: [{ id: 'evt-1', password: 'private' }],
      fakeModelRequests: [{ method: 'POST', headers: { cookie: 'private' } }],
      finalState: { providerSecret: 'private', status: 'complete' },
    });
    assert.equal(
      (bundle.boardLog[0] as Record<string, unknown>).password,
      '[REDACTED]',
    );
    assert.deepEqual(bundle.fakeModelRequests, [{ method: 'POST' }]);
    assert.deepEqual(bundle.finalState, {
      providerSecret: '[REDACTED]',
      status: 'complete',
    });
  });
});
