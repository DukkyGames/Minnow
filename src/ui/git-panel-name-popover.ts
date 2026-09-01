/**
 * Anchored name popover for git panel branch/worktree create (Electron-safe).
 */

import {
  GIT_REF_FALLBACK_BRANCH,
  GIT_REF_FALLBACK_WORKTREE,
  slugifyGitRefName,
  suggestGitRefName,
} from '../lib/git-branch-slug.mjs';

export interface GitPanelNamePopoverOptions {
  anchor: HTMLElement;
  title: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  submitLabel?: string;
  /**
   * When set, typed text is auto-fixed through this function before submit
   * (MIN-659). The popover shows the name that will actually be used.
   */
  normalizeName?: (raw: string) => string;
  onSubmit: (name: string) => void | Promise<void>;
}

export interface GitRefNamePopoverOptions {
  anchor: HTMLElement;
  title: string;
  /** Branch vs worktree only changes fallback + placeholder copy. */
  kind: 'branch' | 'worktree';
  /** Chat / plan title used for the default slug. */
  defaultTitle?: string;
  /** Workspace or worktree path used when the title is empty. */
  defaultPath?: string;
  /** Names already taken (current branch, trunk) so the default is unique. */
  reserved?: Iterable<string | undefined | null>;
  onSubmit: (name: string) => void | Promise<void>;
}

let popoverEl: HTMLDivElement | null = null;
let anchorEl: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;
let open = false;
let outsidePointerHandler: ((e: PointerEvent) => void) | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;

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

/** Close the git panel name popover if open. */
export function closeGitPanelNamePopover(): void {
  if (!open) return;
  open = false;
  detachGlobalListeners();
  anchorEl?.setAttribute('aria-expanded', 'false');
  anchorEl = null;
  inputEl = null;
  popoverEl?.remove();
  popoverEl = null;
}

/** Whether the name popover is visible. */
export function isGitPanelNamePopoverOpen(): boolean {
  return open;
}

function positionPopover(anchor: HTMLElement, popover: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const popoverWidth = popover.offsetWidth || 240;
  const popoverHeight = popover.offsetHeight || 120;

  let top = rect.bottom + 4;
  if (top + popoverHeight > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - popoverHeight - 4);
  }

  let left = rect.right - popoverWidth;
  left = Math.max(margin, Math.min(left, window.innerWidth - popoverWidth - margin));

  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

function attachGlobalListeners(): void {
  outsidePointerHandler = (e: PointerEvent) => {
    const target = e.target as Node | null;
    if (!popoverEl || !anchorEl) return;
    if (popoverEl.contains(target) || anchorEl.contains(target)) return;
    closeGitPanelNamePopover();
  };
  document.addEventListener('pointerdown', outsidePointerHandler, true);

  escapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeGitPanelNamePopover();
  };
  document.addEventListener('keydown', escapeHandler, true);
}

function ensurePopover(): HTMLDivElement {
  if (popoverEl) return popoverEl;

  popoverEl = document.createElement('div');
  popoverEl.className = 'git-panel-name-popover';
  popoverEl.setAttribute('role', 'dialog');
  popoverEl.setAttribute('aria-modal', 'false');
  document.body.appendChild(popoverEl);
  return popoverEl;
}

/**
 * Sync the live "will use" line so the user sees the git name that will be created.
 * Hidden when the typed text already matches the slug.
 */
function updateNormalizedPreview(
  input: HTMLInputElement,
  preview: HTMLElement,
  normalizeName: (raw: string) => string,
  anchor: HTMLElement,
  popover: HTMLElement,
): string {
  const slug = normalizeName(input.value);
  const typed = input.value.trim();
  if (slug && slug !== typed) {
    preview.hidden = false;
    preview.textContent = `Will use ${slug}`;
  } else {
    preview.hidden = true;
    preview.textContent = '';
  }
  positionPopover(anchor, popover);
  return slug;
}

/**
 * Open a small anchored popover to collect a branch or worktree name.
 * Replaces window.prompt for Electron compatibility.
 */
export function openGitPanelNamePopover(options: GitPanelNamePopoverOptions): void {
  if (open && anchorEl === options.anchor) {
    closeGitPanelNamePopover();
    return;
  }

  closeGitPanelNamePopover();

  const popover = ensurePopover();
  popover.replaceChildren();

  const title = document.createElement('div');
  title.className = 'git-panel-name-popover__title';
  title.textContent = options.title;
  title.id = 'gitPanelNamePopoverTitle';
  popover.setAttribute('aria-labelledby', title.id);

  const label = document.createElement('label');
  label.className = 'git-panel-name-popover__label';
  label.textContent = options.label;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'git-panel-name-popover__input';
  input.placeholder = options.placeholder ?? '';
  input.value = options.defaultValue ?? '';
  input.maxLength = 255;
  input.setAttribute('aria-label', options.label);
  label.appendChild(input);

  popover.append(title, label);

  let preview: HTMLParagraphElement | null = null;
  if (options.normalizeName) {
    preview = document.createElement('p');
    preview.className = 'git-panel-name-popover__preview';
    preview.setAttribute('aria-live', 'polite');
    preview.hidden = true;
    popover.appendChild(preview);
  }

  const actions = document.createElement('div');
  actions.className = 'git-panel-name-popover__actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'git-panel-action-btn';
  cancelBtn.textContent = 'Cancel';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'git-panel-action-btn git-panel-action-btn--primary';
  submitBtn.textContent = options.submitLabel ?? 'Create';

  actions.append(cancelBtn, submitBtn);
  popover.append(actions);

  inputEl = input;
  anchorEl = options.anchor;
  open = true;
  anchorEl.setAttribute('aria-expanded', 'true');

  const refreshPreview = (): string | null => {
    if (!preview || !options.normalizeName || !anchorEl) return null;
    return updateNormalizedPreview(input, preview, options.normalizeName, anchorEl, popover);
  };

  const submit = async (): Promise<void> => {
    const raw = input.value;
    const name = options.normalizeName ? options.normalizeName(raw) : raw.trim();
    if (!name) {
      input.focus();
      return;
    }
    closeGitPanelNamePopover();
    await options.onSubmit(name);
  };

  cancelBtn.addEventListener('click', () => closeGitPanelNamePopover());
  submitBtn.addEventListener('click', () => void submit());
  input.addEventListener('input', () => {
    refreshPreview();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  });

  positionPopover(options.anchor, popover);
  attachGlobalListeners();
  refreshPreview();

  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

/**
 * Create-branch / create-worktree popover with auto-fixed git names (MIN-659).
 * Defaults to a slug from the chat title or folder path, not an opaque id.
 */
export function openGitRefNamePopover(options: GitRefNamePopoverOptions): void {
  const fallback =
    options.kind === 'worktree' ? GIT_REF_FALLBACK_WORKTREE : GIT_REF_FALLBACK_BRANCH;
  const defaultValue = suggestGitRefName({
    title: options.defaultTitle,
    path: options.defaultPath,
    fallback,
    reserved: options.reserved,
  });
  openGitPanelNamePopover({
    anchor: options.anchor,
    title: options.title,
    label: 'Branch name',
    placeholder:
      options.kind === 'worktree' ? 'feature/isolated-work' : 'feature/my-branch',
    defaultValue,
    submitLabel: 'Create',
    normalizeName: (raw) => slugifyGitRefName(raw, fallback),
    onSubmit: options.onSubmit,
  });
}
