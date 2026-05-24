/**
 * Settings UI for browser CDP navigation allowlist (`config.json` → `browser`).
 */

import { detectConfigServer, isServerStorageMode } from '../config/storage-mode';
import {
  getBrowserMetaCached,
  invalidateBrowserMetaCache,
  loadBrowserMeta,
  saveBrowserMeta,
  type BrowserMeta,
} from '../config/browser-meta';
import { setStatus } from './status';

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

function serverBanner(message: string): HTMLElement {
  const p = el('p', 'settings-server-banner');
  p.setAttribute('role', 'status');
  p.innerHTML = message;
  return p;
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
    mount.appendChild(
      serverBanner(
        'Browser allowlist settings require <code>npm start</code> (config.json on disk).',
      ),
    );
    return;
  }

  const mode = await detectConfigServer();
  if (mode !== 'server') {
    mount.appendChild(
      serverBanner('Connect with <code>npm start</code> to edit the browser allowlist.'),
    );
    return;
  }

  const meta = initialMeta ?? (await loadBrowserMeta());

  const section = el('section', 'settings-tool-browser');
  const heading = el('h3', 'settings-subheading', 'Browser navigation allowlist');
  section.appendChild(heading);
  section.appendChild(
    el(
      'p',
      'settings-field-hint',
      'CDP browser_navigate only opens URLs matching these glob-like origin patterns (* = any characters). Localhost dev hosts are included by default.',
    ),
  );

  const allowNavRow = el('div', 'settings-toggle-row');
  const allowNavLabel = el('span', undefined, 'Allow navigation');
  const allowNavCb = document.createElement('input');
  allowNavCb.type = 'checkbox';
  allowNavCb.id = 'settingsBrowserAllowNavigate';
  allowNavCb.checked = meta.allowNavigate;
  allowNavRow.append(allowNavLabel, allowNavCb);
  section.appendChild(allowNavRow);

  const urlRow = el('div', 'field settings-tool-browser-url');
  const urlLabel = document.createElement('label');
  urlLabel.htmlFor = 'settingsBrowserDefaultUrl';
  urlLabel.textContent = 'CDP endpoint URL';
  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.id = 'settingsBrowserDefaultUrl';
  urlInput.value = meta.defaultUrl;
  urlInput.placeholder = 'http://127.0.0.1:9222';
  urlRow.append(urlLabel, urlInput);
  section.appendChild(urlRow);

  const patternsRow = el('div', 'field settings-tool-browser-patterns');
  const patternsLabel = document.createElement('label');
  patternsLabel.htmlFor = 'settingsBrowserAllowlistPatterns';
  patternsLabel.textContent = 'Allowed origin patterns (one per line)';
  const patternsArea = document.createElement('textarea');
  patternsArea.id = 'settingsBrowserAllowlistPatterns';
  patternsArea.rows = 6;
  patternsArea.spellcheck = false;
  patternsArea.value = patternsToText(meta.allowedOriginPatterns);
  patternsRow.append(patternsLabel, patternsArea);
  section.appendChild(patternsRow);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'settings-inline-btn';
  saveBtn.textContent = 'Save browser settings';
  section.appendChild(saveBtn);

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

  urlInput.addEventListener('change', () => {
    const v = urlInput.value.trim();
    if (!v) return;
    void (async () => {
      try {
        await saveBrowserMeta({ defaultUrl: v });
        setStatus('ok', 'CDP URL saved');
      } catch {
        setStatus('err', 'Could not save CDP URL');
      }
    })();
  });

  saveBtn.addEventListener('click', () => {
    void (async () => {
      const patterns = parsePatternsText(patternsArea.value);
      if (patterns.length === 0) {
        setStatus('err', 'Add at least one origin pattern');
        return;
      }
      try {
        await saveBrowserMeta({
          allowNavigate: allowNavCb.checked,
          defaultUrl: urlInput.value.trim() || meta.defaultUrl,
          allowedOriginPatterns: patterns,
        });
        invalidateBrowserMetaCache();
        await loadBrowserMeta();
        setStatus('ok', 'Browser allowlist saved');
      } catch {
        setStatus('err', 'Could not save browser allowlist');
      }
    })();
  });
}

/** Cached meta for tools section render (after loadBrowserMeta). */
export function getBrowserSettingsMeta(): BrowserMeta {
  return getBrowserMetaCached();
}
