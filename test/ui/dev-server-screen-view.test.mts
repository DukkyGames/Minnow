import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  deriveDevServerRowView,
  deriveHubDevServersSummary,
} from '../../src/ui/dev-server-screen-view.ts';
import type { DevServerListItem } from '../../src/config/dev-servers-api.ts';

function item(partial: Partial<DevServerListItem> & { id: string }): DevServerListItem {
  const base: DevServerListItem = {
    id: partial.id,
    name: partial.name ?? partial.id,
    def: {
      id: partial.id,
      name: partial.name ?? partial.id,
      command: 'npm run dev',
      port: 5173,
      network: 'local',
      source: 'user',
    },
    status: 'stopped',
    runId: null,
    pid: null,
    healthOk: null,
    startedAt: null,
    portInUse: false,
    port: 5173,
    network: 'local',
    command: 'npm run dev',
    healthUrl: null,
    error: null,
  };
  return { ...base, ...partial };
}

describe('dev-server-screen-view', () => {
  test('offline row', () => {
    const view = deriveDevServerRowView(false, item({ id: 'a', status: 'stopped' }));
    assert.equal(view.uiState, 'offline');
    assert.equal(view.canStart, false);
  });

  test('setup / no_guide', () => {
    const view = deriveDevServerRowView(
      true,
      item({
        id: 'primary',
        status: 'no_guide',
        def: null,
        command: null,
      }),
    );
    assert.equal(view.uiState, 'setup');
  });

  test('running enables stop/restart', () => {
    const view = deriveDevServerRowView(
      true,
      item({ id: 'web', status: 'running', runId: 'r1', startedAt: Date.now() - 60_000 }),
    );
    assert.equal(view.uiState, 'running');
    assert.equal(view.canStop, true);
    assert.equal(view.canRestart, true);
    assert.equal(view.canStart, false);
  });

  test('port-conflict when stopped but port in use', () => {
    const view = deriveDevServerRowView(
      true,
      item({ id: 'web', status: 'stopped', portInUse: true }),
    );
    assert.equal(view.uiState, 'port-conflict');
    assert.ok(view.warning);
  });

  test('hub summary counts running', () => {
    const summary = deriveHubDevServersSummary(true, [
      item({ id: 'a', status: 'running', port: 5173 }),
      item({ id: 'b', status: 'stopped', port: 3001 }),
    ]);
    assert.equal(summary.uiState, 'running');
    assert.match(summary.meta, /1 running/);
  });
});
