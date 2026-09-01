/**
 * Tool approval queue abort signal (P8-A / MIN-754).
 *
 * Stubs the modal so these tests do not need the composer DOM.
 * The stub honours `request.signal` the same way the real strip dismisses.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import type { ToolApprovalRequest } from '../../src/tools/tool-approval-types.ts';

type Decision = 'allow-once' | 'always-allow' | 'cancel';

const showCalls: ToolApprovalRequest[] = [];
const pendingResolvers: Array<(decision: Decision) => void> = [];

mock.module('../../src/ui/tool-approval-modal.ts', {
  namedExports: {
    showToolApprovalModal: (request: ToolApprovalRequest) => {
      showCalls.push(request);
      if (request.signal?.aborted) return Promise.resolve('cancel' as const);
      return new Promise<Decision>((resolve) => {
        pendingResolvers.push(resolve);
        request.signal?.addEventListener(
          'abort',
          () => resolve('cancel'),
          { once: true },
        );
      });
    },
  },
});

const queue = await import('../../src/tools/approval-queue.ts');

function sampleRequest(
  overrides: Partial<ToolApprovalRequest> = {},
): ToolApprovalRequest {
  return {
    toolName: 'save_file',
    title: 'save_file',
    argsJson: '{"path":"src/a.ts"}',
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  showCalls.length = 0;
  pendingResolvers.length = 0;
  queue.resetApprovalQueueForTests();
});

afterEach(() => {
  for (const resolve of pendingResolvers) resolve('cancel');
  pendingResolvers.length = 0;
  queue.resetApprovalQueueForTests();
});

describe('enqueueToolApproval AbortSignal', () => {
  test('already-aborted request resolves cancel without showing the modal', async () => {
    const abort = new AbortController();
    abort.abort();
    const decision = await queue.enqueueToolApproval(
      sampleRequest({ signal: abort.signal }),
    );
    assert.equal(decision, 'cancel');
    assert.equal(showCalls.length, 0);
    assert.equal(queue.hasPendingToolApproval(), false);
  });

  test('abort while queued (not yet shown) resolves cancel and does not stall', async () => {
    const first = new AbortController();
    const shown = queue.enqueueToolApproval(sampleRequest({ toolName: 'first' }));
    await flush();
    assert.equal(showCalls.length, 1);

    const queuedAbort = new AbortController();
    const waiting = queue.enqueueToolApproval(
      sampleRequest({ toolName: 'queued', signal: queuedAbort.signal }),
    );
    await flush();
    assert.equal(showCalls.length, 1, 'second entry waits behind the open strip');

    queuedAbort.abort();
    assert.equal(await waiting, 'cancel');

    pendingResolvers[0]?.('allow-once');
    assert.equal(await shown, 'allow-once');
    await flush();
    assert.equal(showCalls.length, 1, 'aborted waiter must never reach the modal');
    assert.equal(queue.hasPendingToolApproval(), false);
  });

  test('abort while the modal is open resolves cancel and the next queued approval still shows', async () => {
    const firstAbort = new AbortController();
    const first = queue.enqueueToolApproval(
      sampleRequest({ toolName: 'open', signal: firstAbort.signal }),
    );
    const second = queue.enqueueToolApproval(sampleRequest({ toolName: 'next' }));
    await flush();
    assert.equal(showCalls[0]?.toolName, 'open');

    firstAbort.abort();
    assert.equal(await first, 'cancel');
    await flush();
    assert.equal(showCalls[1]?.toolName, 'next', 'queue must drain after abort');

    pendingResolvers.at(-1)?.('always-allow');
    assert.equal(await second, 'always-allow');
    assert.equal(queue.hasPendingToolApproval(), false);
  });

  test('happy path still forwards allow-once', async () => {
    const pending = queue.enqueueToolApproval(sampleRequest());
    await flush();
    pendingResolvers[0]?.('allow-once');
    assert.equal(await pending, 'allow-once');
  });
});
