/**
 * Composer Expand button — one click rewrites the draft into a fuller prompt.
 * Streams in place, never sends: the result stays in the composer for editing.
 */

import { autoResizeDesktopComposer } from '../os/desktop-composer-resize';
import { fetchExpandedPrompt, EXPAND_FAILED_MESSAGE } from './composer-expand-client';
import { iconHtml } from './icon';
import { autoResize } from './input';
import { setStatus } from './status';

interface ExpandTarget {
  /** Button id to mount. */
  btnId: string;
  /** Existing composer button this one is inserted after. */
  anchorIds: string[];
  /** Composer textarea this button expands. */
  inputId: string;
  /** Desktop concierge composer uses its own button chrome. */
  desktop?: boolean;
}

const TARGETS: readonly ExpandTarget[] = [
  { btnId: 'btnComposerExpand', anchorIds: ['btnComposerMic', 'attachBtn'], inputId: 'msgInput' },
  {
    btnId: 'btnChatAppExpand',
    anchorIds: ['btnChatAppMic', 'btnChatAppAttach'],
    inputId: 'chatAppInput',
  },
  {
    btnId: 'btnDesktopExpand',
    anchorIds: ['btnDesktopMic', 'btnDesktopAttach'],
    inputId: 'desktopInput',
    desktop: true,
  },
];

const EXPAND_MARKUP =
  iconHtml('sparkles', { className: 'composer-expand-btn__icon' }) +
  '<span class="composer-expand-btn__spinner" aria-hidden="true"></span>';

const IDLE_LABEL = 'Expand prompt';
const IDLE_TITLE = 'Expand prompt into a fuller version';
const BUSY_LABEL = 'Expanding prompt — click to cancel';
const BUSY_TITLE = 'Expanding… click to cancel';

interface ActiveRun {
  controller: AbortController;
  input: HTMLTextAreaElement;
  /** Draft captured before the first token, restored on cancel. */
  original: string;
}

let activeRun: ActiveRun | null = null;
let expandFetchImpl = fetchExpandedPrompt;

/** Replace the expansion request (unit tests). */
export function setExpandPromptFetcherForTests(
  impl: typeof fetchExpandedPrompt | null,
): void {
  expandFetchImpl = impl ?? fetchExpandedPrompt;
}

function findTargetByButtonId(btnId: string): ExpandTarget | undefined {
  return TARGETS.find((t) => t.btnId === btnId);
}

function resolveInput(target: ExpandTarget): HTMLTextAreaElement | null {
  return document.getElementById(target.inputId) as HTMLTextAreaElement | null;
}

function resizeComposerInput(input: HTMLTextAreaElement): void {
  if (input.id === 'desktopInput') {
    autoResizeDesktopComposer(input);
    return;
  }
  autoResize(input);
}

/**
 * Write text into the composer.
 * Streaming partials only paint — `input` listeners (draft persistence, sidebar
 * rails, send state) fire once on the settled value instead of once per chunk.
 */
function applyToComposer(
  input: HTMLTextAreaElement,
  text: string,
  { notify = true }: { notify?: boolean } = {},
): void {
  input.value = text;
  if (notify) input.dispatchEvent(new Event('input', { bubbles: true }));
  resizeComposerInput(input);
}

function setButtonBusy(btn: HTMLButtonElement, busy: boolean): void {
  btn.classList.toggle('composer-expand-btn--busy', busy);
  btn.setAttribute('aria-busy', busy ? 'true' : 'false');
  btn.setAttribute('aria-label', busy ? BUSY_LABEL : IDLE_LABEL);
  btn.title = busy ? BUSY_TITLE : IDLE_TITLE;
}

/** Disable when there is nothing to expand; never fight the busy state. */
function syncButtonEnabled(btn: HTMLButtonElement, input: HTMLTextAreaElement | null): void {
  if (btn.classList.contains('composer-expand-btn--busy')) return;
  btn.disabled = !input || input.value.trim().length === 0;
}

function syncAllButtons(): void {
  for (const target of TARGETS) {
    const btn = document.getElementById(target.btnId) as HTMLButtonElement | null;
    if (btn) syncButtonEnabled(btn, resolveInput(target));
  }
}

/** Cancel an in-flight expansion and put the original draft back. */
export function cancelComposerExpand(): boolean {
  const run = activeRun;
  if (!run) return false;
  run.controller.abort();
  applyToComposer(run.input, run.original);
  return true;
}

async function runExpand(btn: HTMLButtonElement, target: ExpandTarget): Promise<void> {
  const input = resolveInput(target);
  const original = input?.value ?? '';
  if (!input || !original.trim()) return;

  const controller = new AbortController();
  activeRun = { controller, input, original };
  setButtonBusy(btn, true);
  input.classList.add('composer-expanding');
  input.readOnly = true;
  setStatus('spin', 'Expanding prompt…');

  try {
    const result = await expandFetchImpl({
      draft: original,
      signal: controller.signal,
      onPartial: (text) => {
        if (controller.signal.aborted) return;
        applyToComposer(input, text, { notify: false });
      },
    });

    if (controller.signal.aborted) {
      setStatus('ok', 'Expand cancelled');
      return;
    }
    if (result.error) {
      applyToComposer(input, original);
      setStatus('err', result.error);
      return;
    }
    if (!result.text) {
      applyToComposer(input, original);
      setStatus('ok', 'Ready');
      return;
    }

    applyToComposer(input, result.text);
    setStatus('ok', 'Prompt expanded');
  } catch (err) {
    applyToComposer(input, original);
    setStatus('err', err instanceof Error ? err.message : EXPAND_FAILED_MESSAGE);
  } finally {
    activeRun = null;
    input.readOnly = false;
    input.classList.remove('composer-expanding');
    setButtonBusy(btn, false);
    syncAllButtons();
    // Caret to the end so the user can keep typing where the expansion left off.
    const end = input.value.length;
    input.setSelectionRange(end, end);
    input.focus();
  }
}

function onExpandClick(event: Event): void {
  const btn = event.currentTarget as HTMLButtonElement;
  if (activeRun) {
    cancelComposerExpand();
    return;
  }
  const target = findTargetByButtonId(btn.id);
  if (!target) return;
  void runExpand(btn, target);
}

/** Escape aborts a running expansion without touching the rest of the composer. */
function onComposerKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !activeRun) return;
  if (cancelComposerExpand()) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function bindInput(target: ExpandTarget, btn: HTMLButtonElement): void {
  const input = resolveInput(target);
  if (!input) return;
  if (!input.dataset.expandBound) {
    input.addEventListener('input', () => syncButtonEnabled(btn, input));
    input.addEventListener('keydown', onComposerKeydown);
    input.dataset.expandBound = '1';
  }
  syncButtonEnabled(btn, input);
}

function ensureExpandButton(target: ExpandTarget): void {
  const existing = document.getElementById(target.btnId);
  if (existing instanceof HTMLButtonElement) {
    bindInput(target, existing);
    return;
  }

  const anchor = target.anchorIds
    .map((id) => document.getElementById(id))
    .find((el): el is HTMLElement => el instanceof HTMLElement);
  if (!anchor?.parentElement) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = target.btnId;
  btn.className = target.desktop
    ? 'mn-os-desktop-comp-btn composer-expand-btn'
    : 'input-inset-btn composer-expand-btn';
  btn.setAttribute('aria-label', IDLE_LABEL);
  btn.setAttribute('aria-busy', 'false');
  btn.title = IDLE_TITLE;
  btn.innerHTML = EXPAND_MARKUP;
  btn.disabled = true;
  btn.addEventListener('click', onExpandClick);
  anchor.insertAdjacentElement('afterend', btn);
  bindInput(target, btn);
}

/** Mount Expand buttons on the Code, Chat, and desktop composer surfaces. */
export function initComposerExpand(): void {
  for (const target of TARGETS) {
    ensureExpandButton(target);
  }
}

/** True while an expansion is streaming (tests / send-path guards). */
export function isComposerExpanding(): boolean {
  return activeRun !== null;
}
