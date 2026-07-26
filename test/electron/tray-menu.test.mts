/**
 * Tray menu template labels and enabled state.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildTrayMenuTemplate } from '../../electron/tray-menu-template.ts';

describe('buildTrayMenuTemplate', () => {
  test('lists agent count and disables unload when no models', () => {
    const template = buildTrayMenuTemplate({
      status: { runningAgentCount: 2, loadedLocalModels: [] },
      launchAtStartup: false,
      onOpen: () => {},
      onNewChat: () => {},
      onUnloadModels: () => {},
      onOpenSettings: () => {},
      onToggleStartup: () => {},
      onQuit: () => {},
    });

    const agent = template.find((item) => item.label === 'Agents running: 2');
    assert.ok(agent);
    assert.equal(agent?.enabled, false);

    const unload = template.find((item) => item.label === 'Unload local models');
    assert.ok(unload);
    assert.equal(unload?.enabled, false);
  });

  test('enables unload and summarizes loaded model names', () => {
    const template = buildTrayMenuTemplate({
      status: {
        runningAgentCount: 0,
        loadedLocalModels: [
          { id: 'lm:a:b', label: 'Llama 3', source: 'lm-studio' },
          { id: 'serve:1', label: 'Qwen serve', source: 'minnow-serve' },
        ],
      },
      launchAtStartup: true,
      onOpen: () => {},
      onNewChat: () => {},
      onUnloadModels: () => {},
      onOpenSettings: () => {},
      onToggleStartup: () => {},
      onQuit: () => {},
    });

    const models = template.find((item) =>
      typeof item.label === 'string' && item.label.startsWith('Local models loaded:'),
    );
    assert.ok(models);
    assert.match(models!.label!, /Llama 3/);
    assert.match(models!.label!, /Qwen serve/);

    const startup = template.find((item) => item.label === 'Launch at startup');
    assert.ok(startup);
    assert.equal(startup?.checked, true);

    const unload = template.find((item) => item.label === 'Unload local models');
    assert.equal(unload?.enabled, true);
  });
});
