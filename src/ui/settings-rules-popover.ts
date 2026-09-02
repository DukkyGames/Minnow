import type { UserRuleGroup, UserRuleItem } from '../config/user-rules';
import {
  computeUserRulesTotalBytes,
  MAX_USER_RULES_BYTES,
} from '../config/user-rules';
import { appConfirm } from './app-dialog';

export interface UserRulePopoverDraft {
  title: string;
  text: string;
  groupId: string;
}

export interface OpenUserRulePopoverOptions {
  anchor: HTMLElement;
  mode: 'create' | 'edit';
  groups: UserRuleGroup[];
  initial: UserRulePopoverDraft;
  existingRules?: UserRuleItem[];
  editingRuleId?: string;
  onSubmit: (draft: UserRulePopoverDraft) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}

let popoverEl: HTMLDivElement | null = null;
let anchorEl: HTMLElement | null = null;
let open = false;
let outsidePointerHandler: ((e: PointerEvent) => void) | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;

// ── Close ────────────────────────────────────────────────────────────────────

function detachGlobalListeners(): void {
  if (outsidePointerHandler) {
    document.removeEventListener('pointerdown', outsidePointerHandler, true);
    outsidePointerHandler = null;
  }
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler, true);
    escapeHandler = null;
  }
}

/** Close the user rule popover if open. */
export function closeUserRulePopover(): void {
  if (!open) return;
  open = false;
  detachGlobalListeners();
  anchorEl?.setAttribute('aria-expanded', 'false');
  anchorEl = null;
  popoverEl?.remove();
  popoverEl = null;
}

/** Whether the user rule popover is visible. */
export function isUserRulePopoverOpen(): boolean {
  return open;
}

// ── Position ─────────────────────────────────────────────────────────────────

function positionPopover(anchor: HTMLElement, popover: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const margin = 12;
  const popoverWidth = Math.min(420, window.innerWidth - margin * 2);
  popover.style.width = `${popoverWidth}px`;

  const popoverHeight = popover.offsetHeight || 360;
  let top = rect.bottom + 6;
  if (top + popoverHeight > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - popoverHeight - 6);
  }

  let left = rect.left;
  left = Math.max(margin, Math.min(left, window.innerWidth - popoverWidth - margin));

  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

function attachGlobalListeners(): void {
  outsidePointerHandler = (e: PointerEvent) => {
    const target = e.target as Node | null;
    if (!popoverEl || !anchorEl) return;
    if (popoverEl.contains(target) || anchorEl.contains(target)) return;
    closeUserRulePopover();
  };
  document.addEventListener('pointerdown', outsidePointerHandler, true);

  escapeHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    closeUserRulePopover();
  };
  document.addEventListener('keydown', escapeHandler, true);
}

function ensurePopover(): HTMLDivElement {
  if (popoverEl) return popoverEl;

  popoverEl = document.createElement('div');
  popoverEl.className = 'settings-rules-popover';
  popoverEl.setAttribute('role', 'dialog');
  popoverEl.setAttribute('aria-modal', 'false');
  document.body.appendChild(popoverEl);
  return popoverEl;
}

function estimateDraftBytes(
  draft: UserRulePopoverDraft,
  existingRules: UserRuleItem[],
  editingRuleId?: string,
): number {
  const nextRules = existingRules.map((rule) =>
    rule.id === editingRuleId ? { ...rule, text: draft.text } : rule,
  );
  if (!editingRuleId) {
    nextRules.push({
      id: 'draft',
      title: draft.title,
      text: draft.text,
      enabled: true,
      groupId: draft.groupId,
    });
  }
  return computeUserRulesTotalBytes({
    version: 2,
    enabled: true,
    groups: [],
    rules: nextRules,
  });
}

// ── Open ─────────────────────────────────────────────────────────────────────

/** Open a small popover to name a new rule group. */
export function openUserRuleGroupPopover(options: {
  anchor: HTMLElement;
  onSubmit: (name: string) => void | Promise<void>;
}): void {
  if (open && anchorEl === options.anchor) {
    closeUserRulePopover();
    return;
  }

  closeUserRulePopover();

  const popover = ensurePopover();
  popover.replaceChildren();

  const title = document.createElement('div');
  title.className = 'settings-rules-popover__title';
  title.textContent = 'Add group';
  title.id = 'settingsRulesGroupPopoverTitle';
  popover.setAttribute('aria-labelledby', title.id);

  const nameLabel = document.createElement('label');
  nameLabel.className = 'settings-rules-popover__label';
  nameLabel.textContent = 'Group name';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'settings-rules-popover__input';
  nameInput.placeholder = 'e.g. Coding style';
  nameInput.maxLength = 80;
  nameInput.setAttribute('aria-label', 'Group name');
  nameLabel.appendChild(nameInput);

  const actions = document.createElement('div');
  actions.className = 'settings-rules-popover__actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'settings-action-btn';
  cancelBtn.textContent = 'Cancel';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'settings-action-btn settings-action-btn--primary';
  submitBtn.textContent = 'Add group';

  actions.append(cancelBtn, submitBtn);
  popover.append(title, nameLabel, actions);

  anchorEl = options.anchor;
  open = true;
  anchorEl.setAttribute('aria-expanded', 'true');

  const submit = async (): Promise<void> => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    closeUserRulePopover();
    await options.onSubmit(name);
  };

  cancelBtn.addEventListener('click', () => closeUserRulePopover());
  submitBtn.addEventListener('click', () => void submit());
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  });

  positionPopover(options.anchor, popover);
  attachGlobalListeners();

  requestAnimationFrame(() => {
    nameInput.focus();
  });
}

/** Open the rule editor popover anchored to a button or row. */
export function openUserRulePopover(options: OpenUserRulePopoverOptions): void {
  if (open && anchorEl === options.anchor) {
    closeUserRulePopover();
    return;
  }

  closeUserRulePopover();

  const popover = ensurePopover();
  popover.replaceChildren();

  const title = document.createElement('div');
  title.className = 'settings-rules-popover__title';
  title.textContent = options.mode === 'create' ? 'Add rule' : 'Edit rule';
  title.id = 'settingsRulesPopoverTitle';
  popover.setAttribute('aria-labelledby', title.id);

  const titleLabel = document.createElement('label');
  titleLabel.className = 'settings-rules-popover__label';
  titleLabel.textContent = 'Title';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'settings-rules-popover__input';
  titleInput.placeholder = 'e.g. TypeScript style';
  titleInput.value = options.initial.title;
  titleInput.maxLength = 120;
  titleInput.setAttribute('aria-label', 'Rule title');
  titleLabel.appendChild(titleInput);

  const groupLabel = document.createElement('label');
  groupLabel.className = 'settings-rules-popover__label';
  groupLabel.textContent = 'Group';

  const groupSelect = document.createElement('select');
  groupSelect.className = 'settings-rules-popover__select';
  groupSelect.setAttribute('aria-label', 'Rule group');
  for (const group of options.groups) {
    const opt = document.createElement('option');
    opt.value = group.id;
    opt.textContent = group.name;
    groupSelect.appendChild(opt);
  }
  groupSelect.value = options.initial.groupId;
  groupLabel.appendChild(groupSelect);

  const textLabel = document.createElement('label');
  textLabel.className = 'settings-rules-popover__label';
  textLabel.textContent = 'Instructions';

  const textArea = document.createElement('textarea');
  textArea.className = 'settings-rules-popover__textarea';
  textArea.rows = 8;
  textArea.spellcheck = true;
  textArea.placeholder = 'e.g. Always use TypeScript strict mode. Prefer small diffs.';
  textArea.value = options.initial.text;
  textArea.setAttribute('aria-label', 'Rule instructions');
  textLabel.appendChild(textArea);

  const hint = document.createElement('p');
  hint.className = 'settings-rules-popover__hint';
  hint.textContent = `Combined rule text limit: ${MAX_USER_RULES_BYTES.toLocaleString()} bytes UTF-8.`;

  const error = document.createElement('p');
  error.className = 'settings-rules-popover__error';
  error.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'settings-rules-popover__actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'settings-action-btn';
  cancelBtn.textContent = 'Cancel';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'settings-action-btn settings-action-btn--primary';
  submitBtn.textContent = options.mode === 'create' ? 'Add rule' : 'Save rule';

  actions.append(cancelBtn, submitBtn);

  if (options.mode === 'edit' && options.onDelete) {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'settings-action-btn settings-action-btn--mn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      void (async () => {
        if (
          !(await appConfirm('Delete this rule?', {
            confirmLabel: 'Delete',
            danger: true,
          }))
        ) {
          return;
        }
        closeUserRulePopover();
        await options.onDelete?.();
      })();
    });
    actions.prepend(deleteBtn);
  }

  popover.append(title, titleLabel, groupLabel, textLabel, hint, error, actions);

  anchorEl = options.anchor;
  open = true;
  anchorEl.setAttribute('aria-expanded', 'true');

  const readDraft = (): UserRulePopoverDraft => ({
    title: titleInput.value.trim() || 'Untitled rule',
    text: textArea.value,
    groupId: groupSelect.value,
  });

  const submit = async (): Promise<void> => {
    const draft = readDraft();
    if (!draft.text.trim()) {
      error.textContent = 'Instructions cannot be empty.';
      error.hidden = false;
      textArea.focus();
      return;
    }

    const bytes = estimateDraftBytes(
      draft,
      options.existingRules ?? [],
      options.editingRuleId,
    );
    if (bytes > MAX_USER_RULES_BYTES) {
      error.textContent = `Combined rules exceed ${MAX_USER_RULES_BYTES.toLocaleString()} bytes. Shorten text and try again.`;
      error.hidden = false;
      return;
    }

    closeUserRulePopover();
    await options.onSubmit(draft);
  };

  cancelBtn.addEventListener('click', () => closeUserRulePopover());
  submitBtn.addEventListener('click', () => void submit());
  textArea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  });

  positionPopover(options.anchor, popover);
  attachGlobalListeners();

  requestAnimationFrame(() => {
    if (options.mode === 'create' && !titleInput.value.trim()) {
      titleInput.focus();
      return;
    }
    textArea.focus();
  });
}
