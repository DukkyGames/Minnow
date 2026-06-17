import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  fallbackConciergePlan,
  validateConciergePlan,
  resolveConciergePlan,
} from '../../src/os/concierge-agent.ts';
import type { TitleProviderPort } from '../../src/chat/titles/types.ts';
import type { WorkspaceInfo } from '../../src/config/workspace-api.ts';

const RECENT = [
  { index: 0, path: '/home/user/finance-app', label: 'finance-app', exists: true, isCurrent: false },
  { index: 1, path: '/home/user/minnow', label: 'minnow', exists: true, isCurrent: true },
  { index: 2, path: '/missing', label: 'missing', exists: false, isCurrent: false },
];

describe('validateConciergePlan', () => {
  test('parses research plan with auto_run default', () => {
    const plan = validateConciergePlan(
      { app_id: 'research', seed: 'Apple stock (AAPL)' },
      RECENT,
    );
    assert.ok(plan);
    assert.equal(plan.appId, 'research');
    assert.equal(plan.seed, 'Apple stock (AAPL)');
    assert.equal(plan.autoRun, true);
  });

  test('resolves workspace_index to path when entry exists', () => {
    const plan = validateConciergePlan(
      {
        app_id: 'code',
        seed: 'Find bugs',
        mode_id: 'debug',
        workspace_index: 0,
        auto_run: true,
      },
      RECENT,
    );
    assert.ok(plan);
    assert.equal(plan.workspacePath, '/home/user/finance-app');
    assert.equal(plan.modeId, 'debug');
    assert.equal(plan.autoRun, true);
  });

  test('ignores workspace_index when entry is missing or not on disk', () => {
    const missing = validateConciergePlan(
      { app_id: 'code', workspace_index: 99 },
      RECENT,
    );
    assert.ok(missing);
    assert.equal(missing.workspacePath, undefined);

    const gone = validateConciergePlan(
      { app_id: 'code', workspace_index: 2 },
      RECENT,
    );
    assert.ok(gone);
    assert.equal(gone.workspacePath, undefined);
  });

  test('rejects invalid app_id', () => {
    assert.equal(validateConciergePlan({ app_id: 'unknown' }, RECENT), null);
  });

  test('fallbackConciergePlan routes bug hunts to code with workspace', () => {
    const finalized = fallbackConciergePlan('Find bugs in my finance app', RECENT);
    assert.equal(finalized.appId, 'code');
    assert.equal(finalized.modeId, 'debug');
    assert.equal(finalized.autoRun, true);
    assert.equal(finalized.workspacePath, '/home/user/finance-app');
  });

  test('validateConciergePlan strips navigation-only code seed', () => {
    const plan = validateConciergePlan(
      {
        app_id: 'code',
        seed: "Let's code in our finance app",
        workspace_index: 0,
        auto_run: true,
      },
      RECENT,
      "Let's code in our finance app",
    );
    assert.ok(plan);
    assert.equal(plan.seed, undefined);
    assert.equal(plan.autoRun, false);
    assert.equal(plan.workspacePath, '/home/user/finance-app');
  });

  test('normalizes mode_id via normalizeModeId', () => {
    const plan = validateConciergePlan(
      { app_id: 'code', mode_id: 'not-a-mode' },
      RECENT,
    );
    assert.ok(plan);
    assert.equal(plan.modeId, 'build');
  });
});

describe('fallbackConciergePlan', () => {
  test('clears navigation-only fallback seed for code', () => {
    const plan = fallbackConciergePlan("Let's code in our finance app");
    assert.equal(plan.appId, 'code');
    assert.equal(plan.seed, undefined);
    assert.equal(plan.autoRun, false);
  });

  test('routes debug intents to code with debug mode', () => {
    const plan = fallbackConciergePlan('debug bugs in my finance app');
    assert.equal(plan.appId, 'code');
    assert.equal(plan.modeId, 'debug');
    assert.equal(plan.autoRun, true);
  });

  test('routes research intents with autoRun heuristic', () => {
    const plan = fallbackConciergePlan('research apple stock');
    assert.equal(plan.appId, 'research');
    assert.equal(plan.autoRun, true);
  });

  test('opens research idle for navigation-only chip text', () => {
    const plan = fallbackConciergePlan('Research a topic');
    assert.equal(plan.appId, 'research');
    assert.equal(plan.seed, undefined);
    assert.equal(plan.autoRun, false);
  });

  test('defaults unknown text to chat', () => {
    const plan = fallbackConciergePlan('xyzzy');
    assert.equal(plan.appId, 'chat');
    assert.equal(plan.seed, 'xyzzy');
  });
});

describe('resolveConciergePlan', () => {
  test('corrects LLM chat misroute for bug hunts', async () => {
    const port: TitleProviderPort = {
      async complete() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  app_id: 'chat',
                  seed: 'Find bugs in my finance app',
                  auto_run: false,
                }),
              },
            },
          ],
        };
      },
    };

    const plan = await resolveConciergePlan('Find bugs in my finance app', {
      port,
      fetchWorkspaceImpl: async () =>
        ({
          path: '/home/user/minnow',
          label: 'minnow',
          isDefault: false,
          recent: RECENT.map(({ index, ...rest }) => rest),
        }) as import('../../src/config/workspace-api.ts').WorkspaceInfo,
      timeoutMs: 2000,
    });

    assert.equal(plan.appId, 'code');
    assert.equal(plan.modeId, 'debug');
    assert.equal(plan.autoRun, true);
  });

  test('uses LLM port when JSON is valid', async () => {
    const port: TitleProviderPort = {
      async complete() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  app_id: 'research',
                  seed: 'Apple stock (AAPL)',
                  auto_run: true,
                }),
              },
            },
          ],
        };
      },
    };

    const win = globalThis as typeof globalThis & { document?: Document };
    if (!win.document?.getElementById) {
      const { Window } = await import('happy-dom');
      const dom = new Window();
      const g = globalThis as typeof globalThis & {
        window: Window;
        document: Document;
        HTMLElement: typeof HTMLElement;
      };
      g.window = dom as unknown as Window & typeof globalThis.window;
      g.document = dom.document;
      g.HTMLElement = dom.HTMLElement;
      dom.document.body.innerHTML =
        '<select id="modelSelect"><option value="p1::m1" selected>m1</option></select>';
    } else {
      const sel = document.createElement('select');
      sel.id = 'modelSelect';
      const opt = document.createElement('option');
      opt.value = 'p1::m1';
      opt.selected = true;
      sel.appendChild(opt);
      document.body.appendChild(sel);
    }

    const plan = await resolveConciergePlan("Let's research apple stock", {
      port,
      fetchWorkspaceImpl: async () =>
        ({
          path: '/home/user/minnow',
          label: 'minnow',
          isDefault: false,
          recent: RECENT.map(({ index, ...rest }) => rest),
        }) as WorkspaceInfo,
      timeoutMs: 2000,
    });

    assert.equal(plan.appId, 'research');
    assert.equal(plan.seed, 'Apple stock (AAPL)');
    assert.equal(plan.autoRun, true);
  });

  test('falls back to routeIntent when port throws', async () => {
    const port: TitleProviderPort = {
      async complete() {
        throw new Error('offline');
      },
    };

    const plan = await resolveConciergePlan('benchmark throughput', {
      port,
      fetchWorkspaceImpl: async () => null,
    });

    assert.equal(plan.appId, 'bench');
    assert.equal(plan.seed, 'benchmark throughput');
  });
});
