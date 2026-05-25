/**
 * Agent packs settings: list ~/.minnow/agent-packs, enable toggles, validation status.
 */

import { fetchAgentPacksList, patchAgentPackEnabled } from '../agents/pack-api';
import type { AgentPackListItem } from '../agents/pack-types';
import { isLocalServerAvailable } from '../tools/config';
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

function createSwitch(
  checked: boolean,
  disabled: boolean,
  onChange: (enabled: boolean) => void,
): HTMLLabelElement {
  const row = el('label', 'settings-skill-switch');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'settings-skill-switch__input';
  input.checked = checked;
  input.disabled = disabled;
  input.setAttribute('role', 'switch');
  input.addEventListener('change', () => onChange(input.checked));
  const track = el('span', 'settings-skill-switch__track');
  const thumb = el('span', 'settings-skill-switch__thumb');
  track.appendChild(thumb);
  row.appendChild(input);
  row.appendChild(track);
  return row;
}

function buildPackRow(
  pack: AgentPackListItem,
  onChange: () => void,
): HTMLLIElement {
  const item = el('li', 'settings-skill-card');
  item.dataset.packId = pack.id;

  const head = el('div', 'settings-skill-card__head');
  const meta = el('div', 'settings-skill-card__meta');
  meta.appendChild(el('span', 'settings-skill-card__title', pack.label));
  meta.appendChild(
    el(
      'span',
      'settings-skill-card__id',
      `${pack.id} · v${pack.version} · ${pack.agents.length} agent(s)`,
    ),
  );
  if (pack.description) {
    meta.appendChild(el('p', 'settings-field-hint', pack.description));
  }
  head.appendChild(meta);

  const badge = el(
    'span',
    pack.valid ? 'settings-badge settings-badge--ok' : 'settings-badge settings-badge--warn',
    pack.valid ? 'Valid' : 'Invalid',
  );
  head.appendChild(badge);

  const canToggle = pack.valid && isLocalServerAvailable();
  head.appendChild(
    createSwitch(pack.enabled, !canToggle, (enabled) => {
      void (async () => {
        try {
          const updated = await patchAgentPackEnabled(pack.id, enabled);
          if (!updated) {
            setStatus('err', 'Could not update pack (npm start required)');
            return;
          }
          setStatus('ok', `Pack "${pack.id}" ${enabled ? 'enabled' : 'disabled'}`);
          onChange();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Update failed';
          setStatus('err', message);
        }
      })();
    }),
  );

  item.appendChild(head);

  if (!pack.valid && pack.errors.length) {
    const errList = el('ul', 'settings-pack-errors');
    for (const msg of pack.errors) {
      errList.appendChild(el('li', undefined, msg));
    }
    item.appendChild(errList);
  }

  const pathHint = el(
    'p',
    'settings-field-hint',
    `Folder: ${pack.packRoot}`,
  );
  item.appendChild(pathHint);

  return item;
}

/** Render Agent packs section into the settings panel body. */
export async function renderAgentPacksSettingsSection(body: HTMLElement): Promise<void> {
  body.replaceChildren();

  const intro = el(
    'p',
    'settings-section-intro',
    'Drop-in agent packs live under ~/.minnow/agent-packs/<id>/ with a manifest.json. Enabled packs add work agents (id: packId.agentKey) to the composer and Work agents settings. Requires npm start.',
  );
  body.appendChild(intro);

  body.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Author guide: documentation/agent-packs/README.md — copy _template from ~/.minnow/agent-packs/ after first npm start.',
    ),
  );

  if (!isLocalServerAvailable()) {
    body.appendChild(
      el(
        'p',
        'settings-offline-hint',
        'Start the dev server (npm start) to scan packs and toggle enablement.',
      ),
    );
    return;
  }

  const list = el('ul', 'settings-skill-list');

  const renderList = async (): Promise<void> => {
    list.replaceChildren();
    const packs = await fetchAgentPacksList();
    if (!packs.length) {
      list.appendChild(
        el(
          'li',
          'settings-empty-hint',
          'No packs found. Copy documentation/agent-packs/_template to ~/.minnow/agent-packs/<your-id>/ and refresh.',
        ),
      );
      return;
    }
    for (const pack of packs) {
      list.appendChild(buildPackRow(pack, () => void renderList()));
    }
  };

  body.appendChild(list);
  await renderList();

  const refreshBtn = el('button', 'settings-action-btn', 'Refresh pack list');
  refreshBtn.type = 'button';
  refreshBtn.addEventListener('click', () => void renderList());
  const actions = el('div', 'settings-actions');
  actions.appendChild(refreshBtn);
  body.appendChild(actions);
}
