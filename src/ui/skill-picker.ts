/**
 * Slash-command skill picker anchored above the active composer textarea.
 * Uses fixed positioning on document.body so overflow:hidden ancestors (hub, workspace split) do not clip it.
 */

import { streaming } from '../app-state';
import { UI_DESIGNER_COMPOSER_HINT } from '../agents/ui-designer/runner';
import { impeccableComposerHint } from '../skills/impeccable-client';
import { getSkillCatalog } from '../skills/client';
import type { SkillListItem } from '../skills/types';

let pickerEl: HTMLDivElement | null = null;
let listEl: HTMLUListElement | null = null;
let inputEl: HTMLTextAreaElement | null = null;
let filterQuery = '';
let activeIndex = 0;
let open = false;
let slashStart = -1;
let repositionHandler: (() => void) | null = null;

/** Skills confirmed via picker selection (not manual typing), keyed by element. */
const pickerApplied = new WeakMap<HTMLTextAreaElement, string>();
/** True while applySkill() is dispatching its synthetic input event. */
let applyingSkill = false;

function ensurePicker(): void {
  if (pickerEl) return;

  pickerEl = document.createElement('div');
  pickerEl.className = 'skill-picker hidden';
  pickerEl.setAttribute('role', 'listbox');
  pickerEl.id = 'skillPicker';

  listEl = document.createElement('ul');
  listEl.className = 'skill-picker__list';
  pickerEl.appendChild(listEl);
}

/** Composer row used for viewport anchoring (input-wrap, chat-app-input, desktop wrap). */
function pickerAnchor(el: HTMLTextAreaElement): HTMLElement {
  return el.parentElement ?? el;
}

/** Mount the shared picker on body so scroll/overflow containers cannot clip it. */
function mountPickerPortal(): void {
  ensurePicker();
  if (!pickerEl || pickerEl.parentElement === document.body) return;
  document.body.appendChild(pickerEl);
}

function attachRepositionListeners(): void {
  if (repositionHandler) return;
  repositionHandler = () => {
    if (open) positionPicker();
  };
  window.addEventListener('resize', repositionHandler);
  window.addEventListener('scroll', repositionHandler, true);
}

function detachRepositionListeners(): void {
  if (!repositionHandler) return;
  window.removeEventListener('resize', repositionHandler);
  window.removeEventListener('scroll', repositionHandler, true);
  repositionHandler = null;
}

/** Place the picker above the active composer, flipping below when there is no room. */
function positionPicker(): void {
  if (!pickerEl || !inputEl || !open) return;

  const anchor = pickerAnchor(inputEl);
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const gap = 4;
  const viewportW = window.innerWidth > 0 ? window.innerWidth : 1024;
  const viewportH = window.innerHeight > 0 ? window.innerHeight : 768;
  const width = Math.min(Math.max(rect.width, 280), viewportW - margin * 2);

  pickerEl.style.width = `${width}px`;

  let left = rect.left;
  left = Math.max(margin, Math.min(left, viewportW - width - margin));

  const pickerHeight = pickerEl.offsetHeight;
  let top = rect.top - pickerHeight - gap;
  if (top < margin) {
    top = rect.bottom + gap;
  }
  top = Math.max(margin, Math.min(top, viewportH - pickerHeight - margin));

  pickerEl.style.top = `${top}px`;
  pickerEl.style.left = `${left}px`;
}

function bindActiveInput(el: HTMLTextAreaElement): void {
  inputEl = el;
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
    if (open) positionPicker();
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
    badge.textContent = skill.source === 'user' ? 'Custom' : 'Built-In';

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

  if (open) positionPicker();
}

function closePicker(): void {
  open = false;
  slashStart = -1;
  filterQuery = '';
  activeIndex = 0;
  detachRepositionListeners();
  if (pickerEl) {
    pickerEl.classList.add('hidden');
    pickerEl.style.removeProperty('top');
    pickerEl.style.removeProperty('left');
    pickerEl.style.removeProperty('width');
  }
  if (inputEl) inputEl.setAttribute('aria-expanded', 'false');
}

function openPickerAt(start: number, query: string): void {
  ensurePicker();
  mountPickerPortal();
  open = true;
  slashStart = start;
  filterQuery = query;
  activeIndex = 0;
  if (pickerEl) pickerEl.classList.remove('hidden');
  if (inputEl) inputEl.setAttribute('aria-expanded', 'true');
  renderList();
  attachRepositionListeners();
}

/** Insert /skill-id and trailing space; close picker. */
function applySkill(skillId: string): void {
  if (!inputEl || slashStart < 0) {
    closePicker();
    return;
  }

  const before = inputEl.value.slice(0, slashStart);
  const after = inputEl.value.slice(inputEl.selectionEnd);
  const hint =
    skillId === 'ui-designer'
      ? `plan — ${UI_DESIGNER_COMPOSER_HINT} `
      : skillId === 'impeccable'
        ? `${impeccableComposerHint()} `
        : '';
  const insertion = `/${skillId} ${hint}`;
  inputEl.value = `${before}${insertion}${after.trimStart()}`;
  const caret = before.length + insertion.length;
  inputEl.setSelectionRange(caret, caret);
  pickerApplied.set(inputEl, skillId);
  applyingSkill = true;
  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  applyingSkill = false;
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

/** Returns the skill ID confirmed via picker for this element, or null if typed manually. */
export function getPickerAppliedSkillId(el: HTMLTextAreaElement): string | null {
  return pickerApplied.get(el) ?? null;
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

/** Mount slash picker listeners on one composer textarea (idempotent). */
export function initComposerSlashPicker(composerInput: HTMLTextAreaElement): void {
  if (composerInput.dataset.slashPickerBound === '1') return;
  composerInput.dataset.slashPickerBound = '1';

  composerInput.setAttribute('aria-autocomplete', 'list');
  composerInput.setAttribute('aria-controls', 'skillPicker');

  composerInput.addEventListener('focus', () => {
    bindActiveInput(composerInput);
  });

  composerInput.addEventListener('input', () => {
    if (!applyingSkill) {
      const storedSkill = pickerApplied.get(composerInput);
      if (storedSkill && !new RegExp(`(?:^|\\s)/${storedSkill}(?:\\s|$)`).test(composerInput.value)) {
        pickerApplied.delete(composerInput);
      }
    }
    bindActiveInput(composerInput);
    detectSlashContext();
  });

  composerInput.addEventListener('keydown', (e) => {
    if (inputEl !== composerInput) bindActiveInput(composerInput);
    handleSkillPickerKeydown(e);
  });

  composerInput.addEventListener('blur', () => {
    window.setTimeout(() => closePicker(), 150);
  });
}

/** @deprecated Use initComposerSlashPicker */
export function mountSlashPicker(msgInput: HTMLTextAreaElement): void {
  initComposerSlashPicker(msgInput);
}

/** Wire slash picker on every known composer input present in the DOM. */
export function initAllComposerSlashPickers(): void {
  for (const id of ['msgInput', 'chatAppInput', 'desktopInput']) {
    const el = document.getElementById(id) as HTMLTextAreaElement | null;
    if (el) initComposerSlashPicker(el);
  }
}
