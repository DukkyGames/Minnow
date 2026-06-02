import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  deriveHubDevServerView,
  formatHubDevServerMeta,
  formatHubDevServerOpenUrl,
} from '../../src/ui/hub-dev-server-view.ts';

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

  test('running shows console link and open URL', () => {
    const view = deriveHubDevServerView(
      true,
      'running',
      null,
      'run-1',
      5180,
      'local',
      'http://127.0.0.1:5180/',
    );
    assert.equal(view.uiState, 'running');
    assert.equal(view.showConsole, true);
    assert.equal(view.primaryDisabled, false);
    assert.equal(view.meta, 'running :5180 · this PC');
    assert.equal(view.openUrl, 'http://localhost:5180/');
    assert.equal(view.settingsDisabled, true);
  });

  test('formatHubDevServerOpenUrl falls back to localhost port', () => {
    assert.equal(formatHubDevServerOpenUrl(null, 3000, 'local'), 'http://localhost:3000/');
  });

  test('stopped hides open URL', () => {
    const view = deriveHubDevServerView(true, 'stopped', null, null, 5173, 'local', 'http://127.0.0.1:5173/');
    assert.equal(view.openUrl, null);
  });

  test('stopped exposes port and network in meta', () => {
    const view = deriveHubDevServerView(true, 'stopped', null, null, 3000, 'lan');
    assert.equal(view.meta, 'stopped :3000 · network');
    assert.equal(view.settingsDisabled, false);
  });

  test('formatHubDevServerMeta for starting', () => {
    assert.equal(
      formatHubDevServerMeta('starting', null, 5173, 'local'),
      'starting… :5173 · this PC',
    );
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
