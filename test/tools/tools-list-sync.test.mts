/**
 * Multi-list tool permission UI stays in sync (drawer, settings, composer).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  invalidateToolConfigCache,
  loadToolConfig,
  saveToolConfig,
  setLocalServerAvailable,
  setToolPermission,
} from '../../src/tools/config.ts';
import { defaultToolConfig } from '../../src/config/defaults.ts';
import { fillToolsSection } from '../../src/ui/tools-list.ts';

function setupToolListsDom(): void {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.localStorage = window.localStorage;

  document.body.innerHTML = `
    <div id="toolsList"></div>
    <div id="composerToolsList"></div>
  `;
}

describe('tools list sync', { concurrency: false }, () => {
  afterEach(() => {
    invalidateToolConfigCache();
    setLocalServerAvailable(false);
  });

  test('setToolPermission updates selects in drawer and composer lists', () => {
    setupToolListsDom();
    setLocalServerAvailable(true);

    const config = defaultToolConfig();
    config.permissions.read_file = 'off';
    saveToolConfig(config);

    fillToolsSection('toolsList');
    fillToolsSection('composerToolsList', { variant: 'composer' });

    setToolPermission('read_file', 'full', document.getElementById('toolsList')!);

    const drawerSelect = document
      .querySelector('#toolsList [data-tool-id="read_file"] select')
      ?.value;
    const composerSelect = document
      .querySelector('#composerToolsList [data-tool-id="read_file"] select')
      ?.value;

    assert.equal(drawerSelect, 'full');
    assert.equal(composerSelect, 'full');
    assert.equal(getToolPermissionFromConfig('read_file'), 'full');
  });
});

function getToolPermissionFromConfig(id: string): string {
  const config = loadToolConfig();
  return config.permissions[id] as string;
}
