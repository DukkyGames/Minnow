/**
 * Settings → Thinking — global default and per-agent tri-state overrides.
 */

import {
  loadThinkingMeta,
  saveThinkingMeta,
} from '../config/thinking-meta';
import { appendSettingsCrosslinks } from './settings-layout';
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

function mountGlobalThinkingBlock(mount: HTMLElement): void {
  const section = el('section', 'settings-group');
  section.appendChild(el('h3', 'settings-group__title', 'Global default'));
  const body = el('div', 'settings-group__body');
  section.appendChild(body);

  body.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Default for new chats and roles that inherit global settings. Override per role in Routing.',
    ),
  );

  const row = el('div', 'settings-field-row');
  row.appendChild(el('label', 'settings-field-label', 'Default thinking'));
  const onRadio = el('input') as HTMLInputElement;
  onRadio.type = 'radio';
  onRadio.name = 'thinkingGlobal';
  onRadio.value = 'on';
  const offRadio = el('input') as HTMLInputElement;
  offRadio.type = 'radio';
  offRadio.name = 'thinkingGlobal';
  offRadio.value = 'off';

  void loadThinkingMeta().then((meta) => {
    if (meta.defaultMode === 'off') offRadio.checked = true;
    else onRadio.checked = true;
  });

  const onLabel = el('label', 'settings-inline-radio');
  onLabel.append(onRadio, document.createTextNode(' On'));
  const offLabel = el('label', 'settings-inline-radio');
  offLabel.append(offRadio, document.createTextNode(' Off'));
  row.append(onLabel, offLabel);
  body.appendChild(row);

  const saveBtn = el('button', 'settings-action-btn', 'Save global default');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', () => {
    void (async () => {
      const mode = offRadio.checked ? 'off' : 'on';
      await saveThinkingMeta({ defaultMode: mode });
      setStatus('ok', 'Global thinking default saved');
    })();
  });
  body.appendChild(saveBtn);
  mount.appendChild(section);
}

/** Render Settings → Thinking section. */
export async function renderThinkingSettingsSection(mount: HTMLElement): Promise<void> {
  mount.replaceChildren();
  mountGlobalThinkingBlock(mount);
  appendSettingsCrosslinks(mount, [{ label: 'Per-role overrides in Routing', sectionId: 'model-routing' }]);
}
