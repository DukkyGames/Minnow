/**
 * Settings → Thinking — global default and per-agent tri-state overrides.
 */

import WORK_AGENT_THINKING_DEFAULTS from '../agents/defaults/work-agent-thinking.json';
import {
  fetchWorkAgentsList,
  patchWorkAgentOverride,
} from '../agents/work-agent-prompt-api';
import { getUserWorkAgentOverride } from '../agents/work-agent-registry';
import { saveSubAgentConfigToServer, loadSubAgentConfig } from '../agents/sub-agent-config';
import type { ThinkingTriState } from '../agents/thinking-types';
import {
  DEFAULT_THINKING_GLOBAL,
  loadThinkingMeta,
  saveThinkingMeta,
} from '../config/thinking-meta';
import { isServerStorageMode } from '../config/storage-mode';
import { renderEntityEditorList } from './settings-entity-editor';
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

function builtinWorkAgentThinking(agentId: string): ThinkingTriState {
  const map = WORK_AGENT_THINKING_DEFAULTS as Record<string, ThinkingTriState>;
  return map[agentId] ?? 'inherit';
}

function buildTriStateSelect(
  value: ThinkingTriState,
  onChange: (next: ThinkingTriState) => void,
): HTMLSelectElement {
  const select = el('select', 'settings-select');
  for (const mode of ['inherit', 'on', 'off'] as const) {
    const opt = document.createElement('option');
    opt.value = mode;
    opt.textContent = mode === 'inherit' ? 'Inherit' : mode === 'on' ? 'On' : 'Off';
    select.appendChild(opt);
  }
  select.value = value;
  select.addEventListener('change', () => {
    onChange(select.value as ThinkingTriState);
  });
  return select;
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
      'Default for new chats and inherited paths. Per-agent rows below override role defaults when set.',
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

function mountWorkAgentThinkingOverrides(mount: HTMLElement): void {
  const section = el('section', 'settings-group');
  section.appendChild(el('h3', 'settings-group__title', 'Work agents'));
  const body = el('div', 'settings-group__body');
  section.appendChild(body);

  if (!isServerStorageMode()) {
    body.appendChild(
      el(
        'p',
        'settings-section-note',
        'Start with npm start to edit per-agent thinking overrides.',
      ),
    );
    mount.appendChild(section);
    return;
  }

  void fetchWorkAgentsList().then((remote) => {
    const agents = remote?.agents ?? [];
    if (!agents.length) {
      body.appendChild(el('p', 'settings-section-note', 'No work agents available.'));
      return;
    }

    renderEntityEditorList(
      body,
      agents.map((agent) => ({
        id: agent.id,
        title: agent.label || agent.id,
        hint: `Shipped default: ${builtinWorkAgentThinking(agent.id)}`,
        renderFields: (fieldsMount) => {
          const current =
            getUserWorkAgentOverride(agent.id)?.thinkingMode ??
            builtinWorkAgentThinking(agent.id);
          fieldsMount.appendChild(buildTriStateSelect(current, (next) => {
            void patchWorkAgentOverride(agent.id, {
              thinkingMode: next === builtinWorkAgentThinking(agent.id) ? null : next,
            }).then(() => setStatus('ok', `Thinking saved for ${agent.label || agent.id}`));
          }));
        },
      })),
    );
  });

  mount.appendChild(section);
}

function mountSubAgentThinkingOverrides(mount: HTMLElement): void {
  const section = el('section', 'settings-group');
  section.appendChild(el('h3', 'settings-group__title', 'Sub-agents'));
  const body = el('div', 'settings-group__body');
  section.appendChild(body);

  if (!isServerStorageMode()) {
    body.appendChild(
      el(
        'p',
        'settings-section-note',
        'Start with npm start to edit sub-agent thinking overrides.',
      ),
    );
    mount.appendChild(section);
    return;
  }

  void loadSubAgentConfig().then((config) => {
    const types = Object.entries(config.types ?? {});
    if (!types.length) {
      body.appendChild(el('p', 'settings-section-note', 'No sub-agent types configured.'));
      return;
    }

    renderEntityEditorList(
      body,
      types.map(([typeId, row]) => ({
        id: typeId,
        title: row.label || typeId,
        hint: `Current: ${row.thinkingMode ?? 'inherit'}`,
        renderFields: (fieldsMount) => {
          fieldsMount.appendChild(
            buildTriStateSelect(row.thinkingMode ?? 'inherit', (next) => {
              const merged = {
                ...config,
                types: {
                  ...config.types,
                  [typeId]: { ...row, thinkingMode: next },
                },
              };
              void saveSubAgentConfigToServer(merged).then(() =>
                setStatus('ok', `Thinking saved for ${row.label || typeId}`),
              );
            }),
          );
        },
      })),
    );
  });

  mount.appendChild(section);
}

/** Render Settings → Thinking section. */
export async function renderThinkingSettingsSection(mount: HTMLElement): Promise<void> {
  mount.replaceChildren();
  mount.appendChild(
    el(
      'p',
      'settings-section-note',
      `Global default is ${DEFAULT_THINKING_GLOBAL.defaultMode}. Chat composer can override per chat; explicit on/off applies to sub-agents spawned from that chat.`,
    ),
  );
  mountGlobalThinkingBlock(mount);
  mountWorkAgentThinkingOverrides(mount);
  mountSubAgentThinkingOverrides(mount);
}
