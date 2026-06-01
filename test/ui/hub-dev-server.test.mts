import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deriveHubDevServerView } from '../../src/ui/hub-dev-server-view.ts';

describe('deriveHubDevServerView', () => {
  test('offline when tool server unavailable', () => {
    const view = deriveHubDevServerView(false, 'stopped');
    assert.equal(view.uiState, 'offline');
    assert.equal(view.meta, 'server offline');
    assert.equal(view.primaryDisabled, true);
  });

  test('setup when no startup guide', () => {
    const view = deriveHubDevServerView(true, 'no_guide');
    assert.equal(view.uiState, 'setup');
    assert.equal(view.label, 'Set up');
    assert.equal(view.meta, 'no startup guide');
  });

  test('running shows console link', () => {
    const view = deriveHubDevServerView(true, 'running', null, 'run-1');
    assert.equal(view.uiState, 'running');
    assert.equal(view.showConsole, true);
    assert.equal(view.primaryDisabled, false);
  });

  test('starting disables primary', () => {
    const view = deriveHubDevServerView(true, 'starting');
    assert.equal(view.primaryDisabled, true);
    assert.equal(view.showConsole, true);
  });

  test('error truncates long messages', () => {
    const view = deriveHubDevServerView(
      true,
      'error',
      'x'.repeat(80),
    );
    assert.equal(view.uiState, 'error');
    assert.ok(view.meta.endsWith('…'));
  });
});
