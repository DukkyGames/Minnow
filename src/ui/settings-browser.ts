/**
 * Settings UI for built-in preview browser navigation allowlist (`config.json` → `browser`).
 */

import { detectConfigServer, isServerStorageMode } from '../config/storage-mode';
import {
  getBrowserMetaCached,
  invalidateBrowserMetaCache,
  loadBrowserMeta,
  saveBrowserMeta,
  type BrowserMeta,
} from '../config/browser-meta';
import { normalizeAllowlistPatterns } from '../tools/browser-allowlist-match';
import { createSettingsToggleRow } from './settings-switch';
import {
  appendSettingsOfflineHint,
  createSettingsActionsRow,
  createSettingsRadioRow,
  createSettingsTextareaRow,
} from './settings-controls';
import { setStatus } from './status';
import { getFilePanelState, patchFilePanelState } from '../state/file-panel';
import { syncPreviewDevToolsDockToHost } from './preview-panel';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function patternsToText(patterns: string[]): string {
  return patterns.join('\n');
}

function parsePatternsText(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Renders browser allowlist controls into the tools settings mount node.
 */
export async function renderBrowserAllowlistSettings(
  mount: HTMLElement,
  initialMeta?: BrowserMeta,
): Promise<void> {
  if (!isServerStorageMode()) {
    appendSettingsOfflineHint(
      mount,
      'Browser allowlist settings require <code>npm start</code> (config.json on disk).',
    );
    return;
  }

  const mode = await detectConfigServer();
  if (mode !== 'server') {
    appendSettingsOfflineHint(
      mount,
      'Connect with <code>npm start</code> to edit the browser allowlist.',
    );
    return;
  }

  const meta = initialMeta ?? (await loadBrowserMeta());

  const section = el('section', 'settings-tool-browser');
  const heading = el('h3', 'settings-subheading', 'Built-in browser automation');
  section.appendChild(heading);
  section.appendChild(
    el(
      'p',
      'settings-field-hint',
      'The built-in preview panel (Electron desktop shell) is used for browser_* tools. browser_navigate only opens URLs matching these glob-like origin patterns (* = any characters). Localhost dev hosts are included by default.',
    ),
  );

  const { row: allowNavRow, input: allowNavCb } = createSettingsToggleRow('Allow navigation', {
    id: 'settingsBrowserAllowNavigate',
    checked: meta.allowNavigate,
  });
  section.appendChild(allowNavRow);

  const { row: restoreTabsRow, input: restoreTabsCb } = createSettingsToggleRow(
    'Restore browser tabs',
    {
      id: 'settingsBrowserRestoreTabs',
      checked: meta.restoreBrowserTabs,
    },
  );
  section.appendChild(restoreTabsRow);

  const { row: devToolsDockRow, inputs: devToolsDockInputs, setValue: setDevToolsDockValue } =
    createSettingsRadioRow('DevTools dock', {
      name: 'minnow-preview-devtools-dock',
      searchKey: 'browser.devtoolsDock',
      options: [
        { value: 'bottom', label: 'Bottom' },
        { value: 'side', label: 'Side' },
        { value: 'popout', label: 'Pop out' },
      ],
    });
  const [dockBottom, dockSide, dockPopout] = devToolsDockInputs;
  dockBottom.id = 'settingsBrowserDevToolsDockBottom';
  dockSide.id = 'settingsBrowserDevToolsDockSide';
  dockPopout.id = 'settingsBrowserDevToolsDockPopout';
  setDevToolsDockValue(getFilePanelState().previewDevToolsDock);
  section.appendChild(devToolsDockRow);
  section.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Where Chromium DevTools opens in the preview browser: docked below, docked beside, or in a separate window (Electron desktop shell only).',
    ),
  );

  for (const input of devToolsDockInputs) {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const dock =
        input.value === 'side' ? 'side' : input.value === 'popout' ? 'popout' : 'bottom';
      patchFilePanelState({ previewDevToolsDock: dock });
      void syncPreviewDevToolsDockToHost();
      setStatus('ok', `DevTools dock: ${dock}`);
    });
  }

  const patternsArea = document.createElement('textarea');
  patternsArea.id = 'settingsBrowserAllowlistPatterns';
  patternsArea.rows = 6;
  patternsArea.spellcheck = false;
  patternsArea.value = patternsToText(meta.allowedOriginPatterns);
  section.appendChild(
    createSettingsTextareaRow('Allowed origin patterns (one per line)', {
      textarea: patternsArea,
    }).row,
  );

  section.appendChild(
    createSettingsActionsRow([
      {
        label: 'Save browser settings',
        className: 'settings-inline-btn',
        onClick: () => {
          void (async () => {
            const patterns = normalizeAllowlistPatterns(parsePatternsText(patternsArea.value));
            if (patterns.length === 0) {
              setStatus('err', 'Add at least one origin pattern');
              return;
            }
            patternsArea.value = patternsToText(patterns);
            try {
              await saveBrowserMeta({
                allowNavigate: allowNavCb.checked,
                restoreBrowserTabs: restoreTabsCb.checked,
                allowedOriginPatterns: patterns,
              });
              invalidateBrowserMetaCache();
              await loadBrowserMeta();
              setStatus('ok', 'Browser allowlist saved');
            } catch {
              setStatus('err', 'Could not save browser allowlist');
            }
          })();
        },
      },
    ]),
  );

  mount.appendChild(section);

  allowNavCb.addEventListener('change', () => {
    void (async () => {
      try {
        await saveBrowserMeta({ allowNavigate: allowNavCb.checked });
        setStatus('ok', 'Browser navigation setting saved');
      } catch {
        setStatus('err', 'Could not save browser settings');
        allowNavCb.checked = !allowNavCb.checked;
      }
    })();
  });

  restoreTabsCb.addEventListener('change', () => {
    void (async () => {
      try {
        await saveBrowserMeta({ restoreBrowserTabs: restoreTabsCb.checked });
        setStatus('ok', 'Browser tab restore setting saved');
      } catch {
        setStatus('err', 'Could not save browser settings');
        restoreTabsCb.checked = !restoreTabsCb.checked;
      }
    })();
  });
}

/** Cached meta for tools section render (after loadBrowserMeta). */
export function getBrowserSettingsMeta(): BrowserMeta {
  return getBrowserMetaCached();
}
