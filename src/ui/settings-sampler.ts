/**
 * Settings → Sampler — global defaults and per-agent overrides.
 */

import { loadSamplerMeta, saveSamplerMeta } from '../config/sampler-meta';
import { appendSettingsCrosslinks } from './settings-layout';
import { buildSamplerFieldInputs } from './settings-sampler-fields';
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

async function mountGlobalSamplerBlock(mount: HTMLElement): Promise<void> {
  const section = el('section', 'settings-group');
  section.appendChild(el('h3', 'settings-group__title', 'Global defaults'));
  const body = el('div', 'settings-group__body');
  section.appendChild(body);

  body.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Baseline for main chat completions. Temperature and max tokens also sync to the composer drawer. Per-role overrides are in Models.',
    ),
  );

  const meta = await loadSamplerMeta();
  const globalFields = buildSamplerFieldInputs(meta, {
    includeMaxTokens: true,
    emptyPlaceholder: '',
  });

  body.appendChild(globalFields.root);

  const saveBtn = el('button', 'settings-action-btn', 'Save global defaults');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', () => {
    void (async () => {
      const patch = globalFields.readPatch();
      if (!patch) {
        setStatus('err', 'Enter at least one global sampler value');
        return;
      }
      const next = await saveSamplerMeta(patch);
      globalFields.setValues(next);
      setStatus('ok', 'Global sampler defaults saved');
    })();
  });
  body.appendChild(saveBtn);
  mount.appendChild(section);
}

/** Render Settings → Sampler section. */
export async function renderSamplerSettingsSection(mount: HTMLElement): Promise<void> {
  mount.replaceChildren();
  await mountGlobalSamplerBlock(mount);
  appendSettingsCrosslinks(mount, [{ label: 'Per-role overrides in Models', sectionId: 'model-routing' }]);
}
