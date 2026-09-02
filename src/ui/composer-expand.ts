import { autoResizeDesktopComposer } from '../os/desktop-composer-resize';
import { fetchExpandedPrompt, EXPAND_FAILED_MESSAGE } from './composer-expand-client';
import { iconHtml } from './icon';
import { autoResize } from './input';
import { setStatus } from './status';

interface ExpandTarget {
  /** Button id to mount. */
  btnId: string;
  /** Existing composer button this one is inserted after. Ignored when `prebuilt`. */
  anchorIds: string[];
  /** Composer textarea this button expands. */
  inputId: string;
  /** Desktop concierge composer uses its own button chrome. */
  desktop?: boolean;
  /** Button is already in the DOM; bind in place, do not insert after a mic. */
  prebuilt?: boolean;
  /** Ghost 32px bar control (Super Plan / Research). Send stays the only accent. */
  bar?: boolean;
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
  {
    btnId: 'btnResearchExpand',
    anchorIds: [],
    inputId: 'researchQuery',
    prebuilt: true,
    bar: true,
  },
  {
    btnId: 'btnSuperPlanExpand',
    anchorIds: [],
    inputId: 'superPlanPrompt',
    prebuilt: true,
    bar: true,
  },
];

// ── Targets ──────────────────────────────────────────────────────────────────

/** Find an id under a possibly-disconnected tree (Super Plan builds off-document). */
function findEl(id: string, root: ParentNode = document): HTMLElement | null {
  if ('getElementById' in root && typeof root.getElementById === 'function') {
    return root.getElementById(id);
  }
  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id;
  return root.querySelector(`#${escaped}`);
}

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
/** Bound textarea per expand button (supports off-document Super Plan trees). */
const expandInputByButton = new WeakMap<HTMLButtonElement, HTMLTextAreaElement>();

/** Replace the expansion request (unit tests). */
export function setExpandPromptFetcherForTests(
  impl: typeof fetchExpandedPrompt | null,
): void {
  expandFetchImpl = impl ?? fetchExpandedPrompt;
}

function findTargetByButtonId(btnId: string): ExpandTarget | undefined {
  return TARGETS.find((t) => t.btnId === btnId);
}

function resolveInput(
  target: ExpandTarget,
  root: ParentNode = document,
): HTMLTextAreaElement | null {
  const node = findEl(target.inputId, root);
  return node?.tagName === 'TEXTAREA' ? (node as HTMLTextAreaElement) : null;
}

function resizeComposerInput(input: HTMLTextAreaElement): void {
  if (input.id === 'desktopInput') {
    autoResizeDesktopComposer(input);
    return;
  }
  autoResize(input);
}

// ── Apply ────────────────────────────────────────────────────────────────────

/** Write text into the composer. */
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

/** Cancel only if the active expansion belongs to this textarea. */
export function cancelComposerExpandFor(inputId: string): boolean {
  if (activeRun?.input.id !== inputId) return false;
  return cancelComposerExpand();
}

// ── Run ──────────────────────────────────────────────────────────────────────

async function runExpand(btn: HTMLButtonElement, target: ExpandTarget): Promise<void> {
  const input = expandInputByButton.get(btn) ?? resolveInput(target);
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

function bindInput(
  target: ExpandTarget,
  btn: HTMLButtonElement,
  root: ParentNode = document,
): void {
  const input = resolveInput(target, root);
  if (!input) return;
  expandInputByButton.set(btn, input);
  if (!input.dataset.expandBound) {
    input.addEventListener('input', () => syncButtonEnabled(btn, input));
    input.addEventListener('keydown', onComposerKeydown);
    input.dataset.expandBound = '1';
  }
  syncButtonEnabled(btn, input);
}

function bindExpandButton(
  target: ExpandTarget,
  btn: HTMLButtonElement,
  root: ParentNode = document,
): void {
  if (!btn.innerHTML.trim()) btn.innerHTML = EXPAND_MARKUP;
  if (!btn.hasAttribute('aria-label')) btn.setAttribute('aria-label', IDLE_LABEL);
  if (!btn.hasAttribute('aria-busy')) btn.setAttribute('aria-busy', 'false');
  if (!btn.title) btn.title = IDLE_TITLE;
  if (!btn.dataset.expandClickBound) {
    btn.dataset.expandClickBound = '1';
    btn.addEventListener('click', onExpandClick);
  }
  bindInput(target, btn, root);
}

function ensureExpandButton(target: ExpandTarget, root: ParentNode = document): void {
  const existing = findEl(target.btnId, root);
  if (existing?.tagName === 'BUTTON') {
    bindExpandButton(target, existing as HTMLButtonElement, root);
    return;
  }
  if (target.prebuilt) return;

  const anchor = target.anchorIds
    .map((id) => findEl(id, root))
    .find((el): el is HTMLElement => Boolean(el));
  if (!anchor?.parentElement) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = target.btnId;
  btn.className = target.bar
    ? 'composer-expand-btn composer-expand-btn--bar'
    : target.desktop
      ? 'mn-os-desktop-comp-btn composer-expand-btn'
      : 'input-inset-btn composer-expand-btn';
  btn.setAttribute('aria-label', IDLE_LABEL);
  btn.setAttribute('aria-busy', 'false');
  btn.title = IDLE_TITLE;
  btn.innerHTML = EXPAND_MARKUP;
  btn.disabled = true;
  bindExpandButton(target, btn, root);
  anchor.insertAdjacentElement('afterend', btn);
}

// ── Init ─────────────────────────────────────────────────────────────────────

/** Mount Expand buttons. Pass a search root for disconnected Super Plan trees. */
export function initComposerExpand(root: ParentNode = document): void {
  for (const target of TARGETS) {
    ensureExpandButton(target, root);
  }
}

/** True while an expansion is streaming (tests / send-path guards). */
export function isComposerExpanding(): boolean {
  return activeRun !== null;
}
