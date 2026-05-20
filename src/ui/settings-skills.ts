/**
 * Skills settings section: catalog list, enable toggles, custom skill authoring.
 */

import {
  fetchSkillById,
  getAllSkillCatalog,
  refreshSkillCatalog,
} from '../skills/client';
import {
  getSkillConfig,
  isSkillEnabled,
  loadSkillConfigFromStorage,
  setSkillEnabled,
} from '../skills/config';
import { createCustomSkill, saveSkillContent } from '../skills/skill-settings-api';
import type { SkillListItem, SkillSource } from '../skills/types';
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

function sourceBadgeLabel(source: SkillSource): string {
  return source === 'user' ? 'Custom' : 'Built-In';
}

function createSwitch(
  checked: boolean,
  onChange: (enabled: boolean) => void,
): HTMLLabelElement {
  const row = el('label', 'settings-skill-switch');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'settings-skill-switch__input';
  input.checked = checked;
  input.setAttribute('role', 'switch');
  input.addEventListener('change', () => onChange(input.checked));
  const track = el('span', 'settings-skill-switch__track');
  const thumb = el('span', 'settings-skill-switch__thumb');
  track.appendChild(thumb);
  row.appendChild(input);
  row.appendChild(track);
  return row;
}

function mountSkillEditor(
  body: HTMLElement,
  skill: SkillListItem,
  onSaved: () => void,
): void {
  const hint = el(
    'p',
    'settings-field-hint',
    skill.source === 'builtin'
      ? 'Saving creates or updates ~/.speedchat/skills/ override (built-in ships in src/skills/).'
      : 'Stored in ~/.speedchat/skills/. Requires npm start.',
  );
  body.appendChild(hint);

  const ta = document.createElement('textarea');
  ta.className = 'settings-part-editor';
  ta.rows = 14;
  ta.placeholder = 'SKILL.md content (YAML front matter + markdown body)';
  ta.disabled = true;
  body.appendChild(ta);

  const actions = el('div', 'settings-actions');
  const saveBtn = el('button', 'settings-action-btn', 'Save SKILL.md');
  saveBtn.type = 'button';
  saveBtn.disabled = true;
  actions.appendChild(saveBtn);
  body.appendChild(actions);

  void (async () => {
    const detail = await fetchSkillById(skill.id);
    if (!detail?.body) {
      ta.value = '';
      ta.placeholder = 'Could not load skill (npm start required for custom skills).';
      return;
    }
    ta.value =
      detail.raw ??
      `---\nname: ${detail.id}\nlabel: ${detail.label}\ndescription: ${detail.description}\n---\n\n${detail.body}`;
    ta.disabled = !isLocalServerAvailable();
    saveBtn.disabled = !isLocalServerAvailable();

    saveBtn.addEventListener('click', () => {
      void (async () => {
        try {
          await saveSkillContent(skill.id, ta.value);
          setStatus('ok', `Skill "${skill.id}" saved`);
          await refreshSkillCatalog();
          onSaved();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Save failed';
          setStatus('err', message);
        }
      })();
    });
  })();
}

function buildSkillRow(
  skill: SkillListItem,
  onCatalogChange: () => void,
): HTMLLIElement {
  const item = el('li', 'settings-skill-card');
  item.dataset.skillId = skill.id;
  const head = el('div', 'settings-skill-card__head');

  const meta = el('div', 'settings-skill-card__meta');
  const titleRow = el('div', 'settings-skill-card__title-row');
  titleRow.appendChild(el('span', 'settings-skill-card__label', skill.label));
  const badge = el(
    'span',
    `settings-badge settings-badge--${skill.source}`,
    sourceBadgeLabel(skill.source),
  );
  titleRow.appendChild(badge);
  meta.appendChild(titleRow);
  meta.appendChild(el('span', 'settings-skill-card__id', `/${skill.id}`));

  const description = skill.description?.trim() || 'No description provided.';
  meta.appendChild(el('p', 'settings-skill-card__desc', description));

  head.appendChild(meta);
  head.appendChild(
    createSwitch(isSkillEnabled(skill.id), (enabled) => {
      setSkillEnabled(skill.id, enabled);
      setStatus('ok', enabled ? `${skill.label} enabled` : `${skill.label} disabled`);
      onCatalogChange();
    }),
  );

  const details = document.createElement('details');
  details.className = 'settings-entity-details settings-skill-card__editor';
  const summary = document.createElement('summary');
  summary.className = 'settings-skill-card__edit-toggle';
  summary.textContent = 'Edit SKILL.md';
  details.appendChild(summary);

  const editorBody = el('div', 'settings-entity-editor-body');
  let loaded = false;
  details.addEventListener('toggle', () => {
    if (!details.open || loaded) return;
    loaded = true;
    mountSkillEditor(editorBody, skill, onCatalogChange);
  });
  details.appendChild(editorBody);

  item.appendChild(head);
  item.appendChild(details);
  return item;
}

function promptNewSkillId(): string | null {
  const raw = window.prompt(
    'Custom skill id (lowercase letters, numbers, hyphens):\nExample: my-workflow',
  );
  if (raw === null) return null;
  const id = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    window.alert('Invalid id. Use lowercase letters, numbers, and hyphens only.');
    return null;
  }
  return id;
}

/** Render the Skills settings section into #settingsSkillsBody. */
export async function renderSkillsSettingsSection(mount: HTMLElement): Promise<void> {
  mount.replaceChildren();

  const intro = el(
    'p',
    'settings-field-hint',
    'Skills extend the assistant via /slash commands. Built-in skills ship with SpeedChat; custom skills live under ~/.speedchat/skills/ when npm start is running.',
  );
  mount.appendChild(intro);

  if (!isLocalServerAvailable()) {
    mount.appendChild(
      el(
        'p',
        'settings-server-banner',
        'Start npm start to add custom skills and save edits to ~/.speedchat/skills/.',
      ),
    );
  }

  const toolbar = el('div', 'settings-actions settings-skills-toolbar');
  const addBtn = el('button', 'settings-action-btn settings-action-btn--primary', 'Add custom skill');
  addBtn.type = 'button';
  addBtn.disabled = !isLocalServerAvailable();
  toolbar.appendChild(addBtn);
  mount.appendChild(toolbar);

  const list = el('ul', 'settings-skills-list');
  mount.appendChild(list);

  const redrawList = async (): Promise<void> => {
    await refreshSkillCatalog();
    list.replaceChildren();
    const skills = getAllSkillCatalog();
    if (skills.length === 0) {
      list.appendChild(el('li', 'settings-field-hint', 'No skills found.'));
      return;
    }
    for (const skill of skills) {
      list.appendChild(buildSkillRow(skill, () => void redrawList()));
    }
  };

  addBtn.addEventListener('click', () => {
    const id = promptNewSkillId();
    if (!id) return;

    const labelRaw = window.prompt('Display label (optional):', id
      .split('-')
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' '));
    if (labelRaw === null) return;

    void (async () => {
      try {
        await createCustomSkill(id, labelRaw.trim() || undefined);
        setStatus('ok', `Custom skill "${id}" created — expand to edit SKILL.md`);
        await redrawList();
        const card = list.querySelector(`[data-skill-id="${id}"]`);
        const details = card?.querySelector('details');
        if (details) details.open = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not create skill';
        setStatus('err', message);
      }
    })();
  });

  await loadSkillConfigFromStorage();
  void getSkillConfig();
  await redrawList();
}
