import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Window } from 'happy-dom';
import { BoardScenarioPoller } from '../../src/ui/board-scenario-poller.ts';
import { renderBoardScenarioRunner } from '../../src/ui/board-scenario-runner.ts';
import { classifyScenarioTerminalOutcome } from '../../src/ui/board-scenario-driver.ts';
import { getBoardScenario } from '../../src/dev/orchestrate-scenarios/catalog.ts';

const originalFetch = globalThis.fetch;
let dispose = null;

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function run(overrides = {}) {
  return {
    id: 'run_12345678',
    status: 'prepared',
    classification: null,
    createdAt: '2026-07-28T17:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    currentIteration: null,
    config: {
      scenarioId: 'happy.quick',
      iterations: 1,
      timeoutMs: 120000,
      seed: 513,
      failFast: false,
    },
    summary: { completed: 0, passed: 0, failed: 0 },
    artifacts: [
      { name: 'manifest', path: 'manifest.json', mediaType: 'application/json' },
      {
        name: 'final-state',
        path: '/tmp/minnow/run_12345678/final-state.json',
        mediaType: 'application/json',
      },
    ],
    replayOf: null,
    ...overrides,
  };
}

async function waitFor(predicate, timeoutMs = 500) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition not reached');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(() => {
  dispose?.();
  dispose = null;
  globalThis.fetch = originalFetch;
  globalThis.window?.close();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.HTMLElement;
  delete globalThis.HTMLButtonElement;
});

describe('Settings board scenario runner', () => {
  it('never classifies pass without terminal outcome and clean log evidence', () => {
    const scenario = getBoardScenario('happy.quick');
    assert.ok(scenario);
    assert.equal(
      classifyScenarioTerminalOutcome({
        scenario,
        actual: 'passed',
        logOk: false,
        stateViolations: [],
      }),
      'product_failure',
    );
    assert.equal(
      classifyScenarioTerminalOutcome({
        scenario,
        actual: 'passed',
        logOk: true,
        stateViolations: ['W1-A status mismatch'],
      }),
      'product_failure',
    );
    assert.equal(
      classifyScenarioTerminalOutcome({
        scenario,
        actual: 'blocked',
        logOk: true,
        stateViolations: [],
      }),
      'unexpected_blocked',
    );
    assert.equal(
      classifyScenarioTerminalOutcome({
        scenario,
        actual: 'passed',
        logOk: true,
        stateViolations: [],
      }),
      'pass',
    );
  });

  it('drives and submits deterministic external iterations before rendering pass', async () => {
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.HTMLButtonElement = window.HTMLButtonElement;

    const requestedUrls = [];
    const submissions = [];
    let serverRun = run({
      config: {
        scenarioId: 'happy.quick',
        iterations: 2,
        timeoutMs: 120000,
        seed: 513,
        failFast: false,
        execution: 'external',
      },
    });
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      requestedUrls.push(url);
      assert.equal(init.signal?.aborted ?? false, false);
      if (url.endsWith('/scenarios')) {
        return response({
          scenarios: [
            {
              id: 'happy.quick',
              family: 'happy',
              description: 'Quick preset completes without injected faults.',
              preset: 'quick',
              concurrency: 2,
              expectedOutcome: 'passed',
              faultCount: 0,
              tags: ['baseline'],
            },
          ],
        });
      }
      if (url.endsWith('/runs/prepare')) {
        const body = JSON.parse(init.body);
        assert.equal(body.execution, 'external');
        assert.equal(body.iterations, 2);
        return response({ ok: true, run: serverRun }, 201);
      }
      if (url.endsWith('/fake-model/start')) {
        return response({
          ok: true,
          fakeModel: {
            running: true,
            port: 18765,
            baseUrl: 'http://127.0.0.1:18765',
            requestCount: 0,
            modelId: 'fake-board',
            providerId: 'fake-board',
          },
        });
      }
      if (url.endsWith('/run_12345678/start')) {
        serverRun = {
          ...serverRun,
          status: 'running',
          startedAt: '2026-07-28T17:00:00.000Z',
        };
        return response({
          ok: true,
          run: serverRun,
        });
      }
      if (url.endsWith('/run_12345678/status')) {
        return response({ ok: true, run: serverRun });
      }
      if (url.endsWith('/run_12345678/iterations')) {
        const body = JSON.parse(init.body);
        submissions.push(body);
        const completed = submissions.length;
        serverRun = {
          ...serverRun,
          status: completed === 2 ? 'completed' : 'running',
          classification: 'pass',
          finishedAt: completed === 2 ? '2026-07-28T17:00:00.020Z' : null,
          currentIteration: completed === 2 ? null : completed,
          summary: { completed, passed: completed, failed: 0 },
        };
        return response({ ok: true, run: serverRun });
      }
      if (url.endsWith('/status')) {
        return response({
          ok: true,
          fakeModel: {
            running: true,
            port: 1234,
            baseUrl: 'http://127.0.0.1:1234/v1',
            requestCount: submissions.length * 3,
            modelId: 'fake-board',
            providerId: 'fake-board',
          },
          providerRegistered: true,
          seededBoard: {
            count: 1,
            present: true,
            groupId: 'group',
            plannerId: 'planner',
            workspacePath: '/workspace',
            taskCount: 3,
          },
        });
      }
      if (url.endsWith('/run_12345678/results')) {
        return response({
          ok: true,
          results: {
            runId: 'run_12345678',
            status: 'completed',
            classification: 'pass',
            iterations: submissions.map((submission, iteration) => ({
              iteration,
              seed: submission.seed,
              classification: submission.classification,
              durationMs: 20,
            })),
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const driverCalls = [];
    dispose = renderBoardScenarioRunner(mount, {
      serverUp: true,
      pollIntervalMs: 5,
      driver: {
        async runIteration(context) {
          driverCalls.push(context);
          context.onPhase?.('validating log');
          return {
            classification: 'pass',
            boardLog: [{ type: 'board_terminal', iteration: context.iteration }],
            fakeModelRequests: [{ method: 'POST', url: '/v1/chat/completions' }],
            finalState: { terminal: true },
          };
        },
        stop() {},
      },
    });

    assert.ok(document.querySelector('#boardScenarioCatalog'));
    assert.ok(document.querySelector('#boardScenarioIterations'));
    assert.ok(document.querySelector('#boardScenarioSeed'));
    assert.ok(document.querySelector('#boardScenarioTimeout'));
    assert.equal(
      document.querySelector('.board-scenario-live__detail')?.getAttribute('aria-live'),
      'polite',
    );

    document.querySelector('#boardScenarioIterations').value = '2';
    document.querySelector('#boardScenarioPrepare').click();
    await waitFor(() => document.querySelector('#boardScenarioRun')?.disabled === false);
    document.querySelector('#boardScenarioRun').click();
    await waitFor(
      () => document.querySelector('.board-scenario-live__title')?.textContent === 'Pass',
    );
    await waitFor(() => document.querySelectorAll('.board-scenario-iterations__item').length === 2);

    const text = mount.textContent;
    assert.doesNotMatch(text, /converg/i);
    assert.match(text, /configured driver classified every completed iteration as passing/i);
    assert.deepEqual(
      driverCalls.map((call) => call.seed),
      [513, (513 + Math.imul(1, 0x9e3779b9)) >>> 0],
    );
    assert.deepEqual(
      submissions.map(({ iteration, seed, classification }) => ({
        iteration,
        seed,
        classification,
      })),
      [
        { iteration: 0, seed: 513, classification: 'pass' },
        {
          iteration: 1,
          seed: (513 + Math.imul(1, 0x9e3779b9)) >>> 0,
          classification: 'pass',
        },
      ],
    );
    assert.ok(
      requestedUrls.indexOf('/api/orchestrate/board-testing/fake-model/start') <
        requestedUrls.indexOf('/api/orchestrate/board-testing/runs/run_12345678/start'),
    );
    assert.equal(document.querySelectorAll('.board-scenario-artifacts__item').length, 2);
    assert.equal(document.querySelectorAll('.board-scenario-artifacts a').length, 1);
    assert.match(
      document.querySelector('.board-scenario-artifacts a')?.getAttribute('href') ?? '',
      /^file:\/\//,
    );
    assert.equal(requestedUrls.some((url) => /artifact|download/.test(url)), false);
  });

  it('aborts in-flight mocked fetches when polling restarts or stops', async () => {
    const signals = [];
    globalThis.fetch = (_input, init = {}) => {
      signals.push(init.signal);
      return new Promise((resolve) => {
        init.signal.addEventListener(
          'abort',
          () => resolve(response({ ok: true })),
          { once: true },
        );
      });
    };

    const poller = new BoardScenarioPoller({
      intervalMs: 5,
      fetchSnapshot: async (signal) => {
        await fetch('/mock-status', { signal });
        return { terminal: false };
      },
      onSnapshot: () => assert.fail('aborted request must not publish a snapshot'),
      isTerminal: (snapshot) => snapshot.terminal,
    });

    poller.start();
    await waitFor(() => signals.length === 1);
    poller.start();
    await waitFor(() => signals.length === 2);
    assert.equal(signals[0].aborted, true);
    assert.equal(signals[1].aborted, false);

    poller.stop();
    assert.equal(signals[1].aborted, true);
    assert.equal(poller.active, false);
  });

  it('stops the active board driver and server run together', async () => {
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.HTMLButtonElement = window.HTMLButtonElement;

    let stopCalls = 0;
    let iterationStarted = false;
    const requestedUrls = [];
    let serverRun = run();
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith('/scenarios')) return response({ scenarios: [] });
      if (url.endsWith('/runs/prepare')) return response({ ok: true, run: serverRun }, 201);
      if (url.endsWith('/fake-model/start')) {
        return response({
          ok: true,
          fakeModel: {
            running: true,
            port: 18765,
            baseUrl: 'http://127.0.0.1:18765',
            requestCount: 0,
            modelId: 'fake-board',
            providerId: 'fake-board',
          },
        });
      }
      if (url.endsWith('/run_12345678/start')) {
        serverRun = {
          ...serverRun,
          status: 'running',
          startedAt: '2026-07-28T17:00:00.000Z',
        };
        return response({ ok: true, run: serverRun });
      }
      if (url.endsWith('/run_12345678/status')) {
        return response({ ok: true, run: serverRun });
      }
      if (url.endsWith('/status')) {
        return response({
          ok: true,
          fakeModel: {
            running: true,
            port: 18765,
            baseUrl: 'http://127.0.0.1:18765',
            requestCount: 0,
            modelId: 'fake-board',
            providerId: 'fake-board',
          },
          providerRegistered: true,
          seededBoard: {
            count: 1,
            present: true,
            groupId: 'group',
            plannerId: 'planner',
            workspacePath: '/workspace',
            taskCount: 3,
          },
        });
      }
      if (url.endsWith('/run_12345678/stop')) {
        serverRun = {
          ...serverRun,
          status: 'stopped',
          classification: 'stopped',
          finishedAt: '2026-07-28T17:00:00.010Z',
        };
        return response({ ok: true, run: serverRun });
      }
      if (url.endsWith('/run_12345678/results')) {
        return response({
          ok: true,
          results: {
            runId: serverRun.id,
            status: 'stopped',
            classification: 'stopped',
            iterations: [],
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const mount = document.createElement('div');
    document.body.appendChild(mount);
    dispose = renderBoardScenarioRunner(mount, {
      serverUp: true,
      pollIntervalMs: 5,
      driver: {
        runIteration({ signal }) {
          iterationStarted = true;
          return new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(new DOMException('Stopped', 'AbortError')),
              { once: true },
            );
          });
        },
        stop() {
          stopCalls += 1;
        },
      },
    });

    document.querySelector('#boardScenarioPrepare').click();
    await waitFor(() => document.querySelector('#boardScenarioRun')?.disabled === false);
    document.querySelector('#boardScenarioRun').click();
    await waitFor(() => iterationStarted);
    document.querySelector('#boardScenarioStop').click();
    await waitFor(
      () => document.querySelector('.board-scenario-live__title')?.textContent === 'Stopped',
    );

    assert.equal(stopCalls, 1);
    assert.ok(
      requestedUrls.includes('/api/orchestrate/board-testing/runs/run_12345678/stop'),
    );
  });
});
