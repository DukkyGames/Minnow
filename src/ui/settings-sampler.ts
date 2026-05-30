/**
 * Settings → Sampler — global defaults and per-agent overrides.
 */

import WORK_AGENT_SAMPLER_DEFAULTS from '../agents/defaults/work-agent-samplers.json';
import {
  fetchWorkAgentsList,
  patchWorkAgentOverride,
} from '../agents/work-agent-prompt-api';
import { getUserWorkAgentOverride } from '../agents/work-agent-registry';
import { saveSubAgentConfigToServer, loadSubAgentConfig } from '../agents/sub-agent-config';
import type { SamplerPreset } from '../agents/sampler-types';
import {
  DEFAULT_SAMPLER_GLOBAL,
  loadSamplerMeta,
  saveSamplerMeta,
} from '../config/sampler-meta';
import { isServerStorageMode } from '../config/storage-mode';
import { renderEntityEditorList } from './settings-entity-editor';
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

function builtinWorkAgentSampler(agentId: string): SamplerPreset {
  const map = WORK_AGENT_SAMPLER_DEFAULTS as Record<string, SamplerPreset>;
  return map[agentId] ? { ...map[agentId] } : {};
}

function formatSamplerHint(preset: SamplerPreset | null | undefined): string {
  if (!preset || Object.keys(preset).length === 0) {
    return 'No custom override';
  }
  const parts: string[] = [];
  if (preset.temperature !== undefined) parts.push(`T=${preset.temperature}`);
  if (preset.topP !== undefined) parts.push(`topP=${preset.topP}`);
  if (preset.topK !== undefined) parts.push(`topK=${preset.topK}`);
  if (preset.maxTokens !== undefined) parts.push(`max=${preset.maxTokens}`);
  return parts.length ? parts.join(' · ') : 'Custom';
}

function mountGlobalSamplerBlock(mount: HTMLElement): void {
  const section = el('section', 'settings-group');
  section.appendChild(el('h3', 'settings-group__title', 'Global defaults'));
  const body = el('div', 'settings-group__body');
  section.appendChild(body);

  body.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Baseline for main chat completions. Temperature and max tokens also sync to the composer drawer. Per-agent rows below override role defaults when fields are set.',
    ),
  );

  const globalFields = buildSamplerFieldInputs(DEFAULT_SAMPLER_GLOBAL, {
    includeMaxTokens: true,
    emptyPlaceholder: '',
  });

  void loadSamplerMeta().then((meta) => {
    globalFields.setValues(meta);
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

function mountWorkAgentSamplerOverrides(mount: HTMLElement): void {
  const section = el('section', 'settings-group');
  section.appendChild(el('h3', 'settings-group__title', 'Work agents'));
  const body = el('div', 'settings-group__body');
  section.appendChild(body);

  if (!isServerStorageMode()) {
    body.appendChild(
      el(
        'p',
        'settings-section-note',
        'Start with npm start to edit per-agent sampler overrides.',
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
      agents.map((agent) => {
        const user = getUserWorkAgentOverride(agent.id)?.sampler;
        const roleDefault = builtinWorkAgentSampler(agent.id);
        const roleHint =
          Object.keys(roleDefault).length > 0
            ? `Role default: ${formatSamplerHint(roleDefault)}`
            : 'Role default: inherit global only';
        return {
          id: agent.id,
          label: agent.label,
          hint: `${roleHint} · ${formatSamplerHint(user)}`,
        };
      }),
      (id, container) => {
        const fields = buildSamplerFieldInputs(
          getUserWorkAgentOverride(id)?.sampler,
          { emptyPlaceholder: 'Inherit' },
        );
        container.appendChild(
          el(
            'p',
            'settings-field-hint',
            'Leave fields empty to use the role default, then global defaults.',
          ),
        );
        container.appendChild(fields.root);

        const saveBtn = el('button', 'settings-action-btn', 'Save override');
        saveBtn.type = 'button';
        saveBtn.addEventListener('click', () => {
          void (async () => {
            const agent = await patchWorkAgentOverride(id, {
              sampler: fields.readPatch(),
            });
            if (!agent) {
              setStatus('err', 'Could not save sampler override');
              return;
            }
            setStatus('ok', `${id} sampler override saved`);
            void renderSamplerSettingsSection(mount);
          })();
        });
        container.appendChild(saveBtn);

        const clearBtn = el('button', 'settings-inline-btn', 'Clear override');
        clearBtn.type = 'button';
        clearBtn.addEventListener('click', () => {
          void (async () => {
            const agent = await patchWorkAgentOverride(id, { sampler: null });
            if (!agent) {
              setStatus('err', 'Could not clear override');
              return;
            }
            fields.setValues(null);
            setStatus('ok', `${id} sampler override cleared`);
            void renderSamplerSettingsSection(mount);
          })();
        });
        container.appendChild(clearBtn);
      },
    );
  });

  mount.appendChild(section);
}

function mountSubAgentSamplerOverrides(mount: HTMLElement): void {
  const section = el('section', 'settings-group');
  section.appendChild(el('h3', 'settings-group__title', 'Sub-agent types'));
  const body = el('div', 'settings-group__body');
  section.appendChild(body);

  body.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Sub-agents do not use the main chat drawer. Shipped defaults apply unless you set fields here.',
    ),
  );

  void loadSubAgentConfig().then((config) => {
    renderEntityEditorList(
      body,
      Object.entries(config.types).map(([id, type]) => ({
        id,
        label: type.label ?? id,
        hint: formatSamplerHint(type.sampler),
      })),
      (id, container) => {
        const type = config.types[id];
        if (!type) return;

        const fields = buildSamplerFieldInputs(type.sampler, {
          includeMaxTokens: true,
          emptyPlaceholder: 'Inherit',
        });
        container.appendChild(fields.root);

        const saveBtn = el('button', 'settings-action-btn', 'Save override');
        saveBtn.type = 'button';
        saveBtn.addEventListener('click', () => {
          void (async () => {
            const fresh = await loadSubAgentConfig();
            const ok = await saveSubAgentConfigToServer({
              types: {
                [id]: {
                  ...fresh.types[id],
                  sampler: fields.readPatch(),
                },
              },
            });
            setStatus(ok ? 'ok' : 'err', ok ? `${id} sampler saved` : 'Save failed');
            if (ok) void renderSamplerSettingsSection(mount);
          })();
        });
        container.appendChild(saveBtn);
      },
    );
  });

  mount.appendChild(section);
}

/** Render Settings → Sampler section. */
export async function renderSamplerSettingsSection(mount: HTMLElement): Promise<void> {
  mount.replaceChildren();
  mountGlobalSamplerBlock(mount);
  mountWorkAgentSamplerOverrides(mount);
  mountSubAgentSamplerOverrides(mount);
}
