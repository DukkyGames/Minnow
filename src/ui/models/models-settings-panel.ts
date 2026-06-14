/**
 * Models → Settings — HF token and custom model directories.
 */

import { fetchModelsConfig, saveModelsConfig } from '../../models/api-client';
import { setStatus } from '../status';

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

/** Render Models settings panel (HF token + model dirs). */
export async function mountModelsSettingsSection(): Promise<void> {
  const mount = document.getElementById('modelsSettingsBody');
  if (!mount) return;
  mount.replaceChildren(el('p', 'models-muted', 'Loading settings…'));

  try {
    const config = await fetchModelsConfig();
    mount.replaceChildren();

    const hfCard = el('div', 'models-hardware-card');
    hfCard.appendChild(el('h3', 'models-hardware-card__title', 'Hugging Face token'));
    hfCard.appendChild(
      el(
        'p',
        'models-muted',
        'Optional. Required for gated models and higher rate limits. Stored in config.json (plaintext until encrypted secrets land).',
      ),
    );

    const hfRow = el('div', 'models-settings-row');
    const hfInput = document.createElement('input');
    hfInput.type = 'password';
    hfInput.className = 'models-settings-input';
    hfInput.autocomplete = 'off';
    hfInput.placeholder = config.hfTokenConfigured
      ? `Stored (${config.hfTokenMasked}) — enter to replace`
      : 'hf_…';
    hfRow.append(hfInput);
    hfCard.appendChild(hfRow);

    const hfActions = el('div', 'models-installed-actions');
    const saveHf = el('button', 'models-inline-btn is-primary', 'Save token');
    saveHf.type = 'button';
    const clearHf = el('button', 'models-inline-btn', 'Clear token');
    clearHf.type = 'button';
    clearHf.hidden = !config.hfTokenConfigured;
    hfActions.append(saveHf, clearHf);
    hfCard.appendChild(hfActions);
    mount.appendChild(hfCard);

    const dirsCard = el('div', 'models-hardware-card');
    dirsCard.appendChild(el('h3', 'models-hardware-card__title', 'Extra model directories'));
    dirsCard.appendChild(
      el('p', 'models-muted', 'Additional folders scanned by What fits and Installed (besides HF cache and ~/.minnow/models).'),
    );

    const dirsList = el('div', 'models-model-dirs');
    const renderDirs = (dirs: string[]) => {
      dirsList.replaceChildren();
      if (!dirs.length) {
        dirsList.appendChild(el('p', 'models-muted', 'No extra directories configured.'));
        return;
      }
      for (const dir of dirs) {
        const tag = el('span', 'models-model-dir-tag', dir);
        dirsList.appendChild(tag);
      }
    };
    renderDirs(config.modelDirs);

    const dirInput = document.createElement('input');
    dirInput.type = 'text';
    dirInput.className = 'models-settings-input';
    dirInput.placeholder = '~/models or C:\\models';
    const addDirBtn = el('button', 'models-inline-btn', 'Add directory');
    addDirBtn.type = 'button';
    const dirRow = el('div', 'models-settings-row');
    dirRow.append(dirInput, addDirBtn);
    dirsCard.append(dirsList, dirRow);

    let currentDirs = [...config.modelDirs];
    addDirBtn.addEventListener('click', () => {
      const val = dirInput.value.trim();
      if (!val || currentDirs.includes(val)) return;
      currentDirs = [...currentDirs, val];
      dirInput.value = '';
      renderDirs(currentDirs);
    });

    const saveDirs = el('button', 'models-inline-btn is-primary', 'Save directories');
    saveDirs.type = 'button';
    saveDirs.addEventListener('click', () => {
      void saveModelsConfig({ modelDirs: currentDirs })
        .then((next) => {
          currentDirs = [...next.modelDirs];
          renderDirs(currentDirs);
          setStatus('ok', 'Model directories saved.');
        })
        .catch((err) => {
          setStatus('err', err instanceof Error ? err.message : 'Save failed');
        });
    });
    dirsCard.appendChild(saveDirs);
    mount.appendChild(dirsCard);

    saveHf.addEventListener('click', () => {
      const token = hfInput.value.trim();
      if (!token) {
        setStatus('err', 'Enter a token or use Clear.');
        return;
      }
      void saveModelsConfig({ hfToken: token })
        .then((next) => {
          hfInput.value = '';
          hfInput.placeholder = `Stored (${next.hfTokenMasked}) — enter to replace`;
          clearHf.hidden = !next.hfTokenConfigured;
          setStatus('ok', 'Hugging Face token saved.');
        })
        .catch((err) => {
          setStatus('err', err instanceof Error ? err.message : 'Save failed');
        });
    });

    clearHf.addEventListener('click', () => {
      void saveModelsConfig({ clearHfToken: true })
        .then(() => {
          hfInput.value = '';
          hfInput.placeholder = 'hf_…';
          clearHf.hidden = true;
          setStatus('ok', 'Hugging Face token cleared.');
        })
        .catch((err) => {
          setStatus('err', err instanceof Error ? err.message : 'Clear failed');
        });
    });
  } catch (err) {
    mount.replaceChildren();
    mount.appendChild(
      el('p', 'models-error', err instanceof Error ? err.message : 'Failed to load settings.'),
    );
  }
}
