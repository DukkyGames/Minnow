/**
 * Verdict derivation and running / failed / done panel states.
 * Do not assert.equal a happy-dom node: the Myers diff can freeze the machine.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import type { SubAgentFinding } from '../../src/agents/sub-agent-structured-outcome.ts';
import type { PrReviewRecord } from '../../src/state/pr-review-store.ts';
import { derivePrReviewVerdict, renderPrReviewPanel, unmountPrReviewPanel } from '../../src/ui/pr-review-panel.ts';

function setupDom(): Window {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  return window;
}

function record(partial: Partial<PrReviewRecord>): PrReviewRecord {
  return {
    key: 'acme/minnow#12',
    repo: 'acme/minnow',
    number: 12,
    url: 'https://github.com/acme/minnow/pull/12',
    headRef: 'feat/review',
    baseRef: 'main',
    headSha: 'abc1234deadbeef',
    chatId: 'chat-1',
    runId: 'run-1',
    status: 'done',
    summary: 'REQUEST_CHANGES — 1 blocker. Authz is skipped on delete.',
    findings: [],
    artifacts: [],
    startedAt: 1,
    ...partial,
  };
}

describe('derivePrReviewVerdict', () => {
  test('any blocker is REQUEST_CHANGES', () => {
    const findings: SubAgentFinding[] = [
      { title: 'a', detail: 'a', severity: 'warn' },
      { title: 'b', detail: 'b', severity: 'blocker' },
    ];
    assert.equal(derivePrReviewVerdict(findings), 'REQUEST_CHANGES');
  });

  test('warn only is NEEDS_DISCUSSION', () => {
    const findings: SubAgentFinding[] = [
      { title: 'a', detail: 'a', severity: 'warn' },
      { title: 'b', detail: 'b', severity: 'info' },
    ];
    assert.equal(derivePrReviewVerdict(findings), 'NEEDS_DISCUSSION');
  });

  test('neither blocker nor warn is APPROVE', () => {
    const findings: SubAgentFinding[] = [{ title: 'a', detail: 'a', severity: 'info' }];
    assert.equal(derivePrReviewVerdict(findings), 'APPROVE');
    assert.equal(derivePrReviewVerdict([]), 'APPROVE');
  });
});

describe('renderPrReviewPanel', () => {
  let host: HTMLElement | undefined;

  afterEach(() => {
    if (host) unmountPrReviewPanel(host);
    host = undefined;
  });

  test('running shows a live status line', () => {
    setupDom();
    host = document.createElement('div');
    document.body.appendChild(host);
    renderPrReviewPanel(host, record({ status: 'running', summary: '', findings: [] }));
    const live = host.querySelector('.pr-review__live');
    assert.ok(live);
    assert.ok((live.textContent ?? '').length > 0);
  });

  test('failed shows the error and Retry', () => {
    setupDom();
    host = document.createElement('div');
    document.body.appendChild(host);
    renderPrReviewPanel(host, record({ status: 'failed', error: 'gh is signed out' }), {
      onRetry: () => undefined,
    });
    const err = host.querySelector('.pr-review__error');
    assert.ok(err);
    assert.equal(err.textContent, 'gh is signed out');
    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
    assert.ok(retry);
  });

  test('done shows verdict, grouped findings, and path chips', () => {
    setupDom();
    host = document.createElement('div');
    document.body.appendChild(host);
    renderPrReviewPanel(
      host,
      record({
        findings: [
          {
            title: 'Missing authz',
            detail: 'Gate the handler. Suggested fix: compare session user id.',
            severity: 'blocker',
            paths: ['src/api/delete.ts'],
          },
        ],
      }),
      { onMerge: () => undefined, onFix: () => undefined },
    );
    const verdict = host.querySelector('.pr-review__verdict');
    assert.ok(verdict);
    assert.equal(verdict.textContent, 'Request changes');
    const path = host.querySelector('.pr-review__path');
    assert.ok(path);
    assert.equal(path.textContent, 'src/api/delete.ts');
    const merge = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Merge');
    assert.ok(merge);
  });
});
