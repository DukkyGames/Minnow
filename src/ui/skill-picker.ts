/**
 * Slash-command skill picker anchored above #msgInput.
 */

import { streaming } from '../app-state';
import { getSkillCatalog } from '../skills/client';
import type { SkillListItem } from '../skills/types';

let pickerEl: HTMLDivElement | null = null;
let listEl: HTMLUListElement | null = null;
let inputEl: HTMLTextAreaElement | null = null;
let filterQuery = '';
let activeIndex = 0;
let open = false;
let slashStart = -1;

function ensurePicker(): void {
  if (pickerEl) return;

  pickerEl = document.createElement('div');
  pickerEl.className = 'skill-picker hidden';
  pickerEl.setAttribute('role', 'listbox');
  pickerEl.id = 'skillPicker';

  listEl = document.createElement('ul');
  listEl.className = 'skill-picker__list';
  pickerEl.appendChild(listEl);

  const wrap = document.querySelector('.input-wrap');
  if (wrap) {
    wrap.appendChild(pickerEl);
  } else {
    document.body.appendChild(pickerEl);
  }
}

function filteredSkills(): SkillListItem[] {
  const catalog = [...getSkillCatalog()];
  const q = filterQuery.toLowerCase();
  if (!q) return catalog;
  return catalog.filter(
    (s) =>
      s.id.toLowerCase().includes(q) ||
      s.label.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q),
  );
}

function renderList(): void {
  if (!listEl || !pickerEl) return;

  const items = filteredSkills();
  listEl.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'skill-picker__empty';
    empty.textContent = 'No matching skills';
    listEl.appendChild(empty);
    activeIndex = 0;
    return;
  }

  if (activeIndex >= items.length) activeIndex = items.length - 1;
  if (activeIndex < 0) activeIndex = 0;

  items.forEach((skill, i) => {
    const li = document.createElement('li');
    li.className = 'skill-picker__item';
    li.setAttribute('role', 'option');
    li.id = `skill-opt-${skill.id}`;
    li.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
    if (i === activeIndex) {
      li.classList.add('skill-picker__item--active');
      pickerEl.setAttribute('aria-activedescendant', li.id);
    }

    const badge = document.createElement('span');
    badge.className = `skill-picker__badge skill-picker__badge--${skill.source}`;
    badge.textContent = skill.source === 'user' ? 'Custom' : 'Built-in';

    const label = document.createElement('span');
    label.className = 'skill-picker__label';
    label.textContent = skill.label;

    const id = document.createElement('code');
    id.className = 'skill-picker__id';
    id.textContent = `/${skill.id}`;

    const desc = document.createElement('span');
    desc.className = 'skill-picker__desc';
    desc.textContent = skill.description;

    li.appendChild(badge);
    li.appendChild(label);
    li.appendChild(id);
    li.appendChild(desc);

    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      applySkill(skill.id);
    });

    listEl.appendChild(li);
  });
}

function closePicker(): void {
  open = false;
  slashStart = -1;
  filterQuery = '';
  activeIndex = 0;
  if (pickerEl) pickerEl.classList.add('hidden');
  if (inputEl) inputEl.setAttribute('aria-expanded', 'false');
}

function openPickerAt(start: number, query: string): void {
  ensurePicker();
  open = true;
  slashStart = start;
  filterQuery = query;
  activeIndex = 0;
  if (pickerEl) pickerEl.classList.remove('hidden');
  if (inputEl) inputEl.setAttribute('aria-expanded', 'true');
  renderList();
}

/** Insert /skill-id and trailing space; close picker. */
function applySkill(skillId: string): void {
  if (!inputEl || slashStart < 0) {
    closePicker();
    return;
  }

  const before = inputEl.value.slice(0, slashStart);
  const after = inputEl.value.slice(inputEl.selectionEnd);
  const insertion = `/${skillId} `;
  inputEl.value = `${before}${insertion}${after.trimStart()}`;
  const caret = before.length + insertion.length;
  inputEl.setSelectionRange(caret, caret);
  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  closePicker();
  inputEl.focus();
}

function detectSlashContext(): void {
  if (!inputEl || streaming) {
    closePicker();
    return;
  }

  const value = inputEl.value;
  const pos = inputEl.selectionStart;
  const before = value.slice(0, pos);
  const slashMatch = before.match(/(?:^|\s)\/([a-z0-9-]*)$/);

  if (!slashMatch || slashMatch.index == null) {
    closePicker();
    return;
  }

  const leadingWs = slashMatch[0].startsWith(' ') ? 1 : 0;
  const start = slashMatch.index + leadingWs;
  openPickerAt(start, slashMatch[1] ?? '');
}

/** Whether picker is open (Enter should select, not send). */
export function isSkillPickerOpen(): boolean {
  return open;
}

/** Handle keyboard while picker is open. Returns true if consumed. */
export function handleSkillPickerKeydown(e: KeyboardEvent): boolean {
  if (!open) return false;

  const items = filteredSkills();
  if (e.key === 'Escape') {
    e.preventDefault();
    closePicker();
    return true;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, Math.max(0, items.length - 1));
    renderList();
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    renderList();
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    if (items.length > 0) {
      e.preventDefault();
      applySkill(items[activeIndex].id);
      return true;
    }
  }
  return false;
}

/** Mount slash picker listeners on the composer. */
export function mountSlashPicker(msgInput: HTMLTextAreaElement): void {
  inputEl = msgInput;
  inputEl.setAttribute('aria-autocomplete', 'list');
  inputEl.setAttribute('aria-controls', 'skillPicker');

  msgInput.addEventListener('input', () => {
    detectSlashContext();
  });

  msgInput.addEventListener('keydown', (e) => {
    if (handleSkillPickerKeydown(e)) return;
  });

  msgInput.addEventListener('blur', () => {
    window.setTimeout(() => closePicker(), 150);
  });
}
