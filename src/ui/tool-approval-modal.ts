/**
 * Inline tool approval strip above the composer (not a centered modal).
 * Matches Minnow bench tokens: --surface, --border, mono for payload preview.
 */

import type { ToolApprovalRequest } from '../tools/tool-approval-types';

export type ToolApprovalModalResult = 'allow-once' | 'always-allow' | 'cancel';

function getToolApprovalHost(): HTMLElement | null {
  return document.getElementById('toolApprovalHost');
}

/**
 * Maps a key event to approval choice 1–3, or null if not a plain digit hotkey.
 * Uses `code` so layout / numpad variants still match when `key` differs.
 */
function digitHotkeyChoice(ev: KeyboardEvent): 1 | 2 | 3 | null {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return null;
  // Shift + top-row digit is punctuation on common layouts; `code` is still Digit1…Digit3.
  if (ev.shiftKey && /^Digit[1-3]$/.test(ev.code)) return null;
  const byCode: Record<string, 1 | 2 | 3> = {
    Digit1: 1,
    Digit2: 2,
    Digit3: 3,
    Numpad1: 1,
    Numpad2: 2,
    Numpad3: 3,
  };
  const fromCode = byCode[ev.code];
  if (fromCode !== undefined) return fromCode;
  if (ev.key === '1' || ev.key === '2' || ev.key === '3') {
    return Number(ev.key) as 1 | 2 | 3;
  }
  return null;
}

/**
 * True when focus is in a text-entry control outside the approval host (do not steal 1/2/3).
 */
function isTypingOutsideApprovalHost(host: HTMLElement, el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (host.contains(el)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') {
    const te = el as HTMLTextAreaElement | HTMLSelectElement;
    return !te.disabled;
  }
  if (tag === 'INPUT') {
    const input = el as HTMLInputElement;
    const t = input.type;
    if (t === 'button' || t === 'submit' || t === 'reset' || t === 'checkbox' || t === 'radio' || t === 'file' || t === 'hidden') {
      return false;
    }
    return !input.disabled && !input.readOnly;
  }
  return false;
}

/**
 * Renders the approval strip in the `#toolApprovalHost` slot (see index.html) and resolves when the user picks an action.
 */
export function showToolApprovalModal(
  request: ToolApprovalRequest,
): Promise<ToolApprovalModalResult> {
  return new Promise((resolve) => {
    const host = getToolApprovalHost();
    if (!host) {
      resolve('cancel');
      return;
    }

    /** Hides the composer row (`.input-bar`) via CSS while the approval strip is visible (see `tool-approval.css`). */
    const mainColumn = document.getElementById('mainColumn');

    const msgInput = document.getElementById('msgInput') as HTMLTextAreaElement | null;
    const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement | null;
    const prevInputDisabled = msgInput?.disabled ?? false;
    const prevSendDisabled = sendBtn?.disabled ?? false;
    if (msgInput) msgInput.disabled = true;
    if (sendBtn) sendBtn.disabled = true;

    mainColumn?.classList.add('main-column--tool-approval-pending');
    host.hidden = false;
    host.replaceChildren();

    const panel = document.createElement('div');
    panel.className = 'tool-approval-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-labelledby', 'tool-approval-title');

    const header = document.createElement('div');
    header.className = 'tool-approval-panel__header';

    const heading = document.createElement('h2');
    heading.id = 'tool-approval-title';
    heading.className = 'tool-approval-panel__title';
    heading.textContent = `Allow ${request.title}?`;

    header.appendChild(heading);

    if (request.subAgentType) {
      const badge = document.createElement('span');
      badge.className = 'tool-approval-badge';
      badge.textContent = `Sub-agent · ${request.subAgentType}`;
      header.appendChild(badge);
    }

    const toolIdRow = document.createElement('p');
    toolIdRow.className = 'tool-approval-tool-id';
    toolIdRow.textContent = request.toolName;

    const body = document.createElement('div');
    body.className = 'tool-approval-stack';

    if (request.workspace) {
      const ws = document.createElement('section');
      ws.className = 'tool-approval-block';
      const wsLabel = document.createElement('div');
      wsLabel.className = 'tool-approval-block__label';
      wsLabel.textContent = 'Workspace';
      ws.appendChild(wsLabel);
      if ('hint' in request.workspace) {
        const hint = document.createElement('p');
        hint.className = 'tool-approval-block__text';
        hint.textContent = request.workspace.hint;
        ws.appendChild(hint);
      } else {
        const name = document.createElement('p');
        name.className = 'tool-approval-block__text';
        name.textContent = request.workspace.label;
        const path = document.createElement('pre');
        path.className = 'tool-approval-mono-inline';
        path.textContent = request.workspace.path;
        ws.append(name, path);
      }
      body.appendChild(ws);
    }

    if (request.pathWarning) {
      const warn = document.createElement('div');
      warn.className = 'tool-approval-callout';
      warn.setAttribute('role', 'note');
      warn.textContent = request.pathWarning;
      body.appendChild(warn);
    }

    if (request.description) {
      const desc = document.createElement('p');
      desc.className = 'tool-approval-description';
      desc.textContent = request.description;
      body.appendChild(desc);
    }

    const argsSection = document.createElement('section');
    argsSection.className = 'tool-approval-block';
    const argsLabel = document.createElement('div');
    argsLabel.className = 'tool-approval-block__label';
    argsLabel.textContent = 'Arguments';
    const pre = document.createElement('pre');
    pre.className = 'tool-approval-code';
    pre.textContent = request.argsJson;
    argsSection.append(argsLabel, pre);
    body.appendChild(argsSection);

    const actions = document.createElement('div');
    actions.className = 'tool-approval-panel__actions';

    const btnAllowOnce = document.createElement('button');
    btnAllowOnce.type = 'button';
    btnAllowOnce.className =
      'tool-approval-action tool-approval-action--outline';
    btnAllowOnce.innerHTML =
      '<span class="tool-approval-action__kbd" aria-hidden="true">1</span><span class="tool-approval-action__label">Allow once</span>';

    const btnAlways = document.createElement('button');
    btnAlways.type = 'button';
    btnAlways.className =
      'tool-approval-action tool-approval-action--accent';
    btnAlways.innerHTML =
      '<span class="tool-approval-action__kbd" aria-hidden="true">2</span><span class="tool-approval-action__label">Always allow</span>';

    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className =
      'tool-approval-action tool-approval-action--muted';
    btnCancel.innerHTML =
      '<span class="tool-approval-action__kbd" aria-hidden="true">3</span><span class="tool-approval-action__label">Cancel</span>';

    btnAllowOnce.setAttribute('aria-keyshortcuts', '1');
    btnAlways.setAttribute('aria-keyshortcuts', '2');
    btnCancel.setAttribute('aria-keyshortcuts', '3');

    actions.append(btnAllowOnce, btnAlways, btnCancel);

    const hints = document.createElement('p');
    hints.className = 'tool-approval-hints';
    hints.textContent = 'Keys 1 / 2 / 3 while this prompt is open · Esc to cancel';

    panel.append(header, toolIdRow, body, actions, hints);
    host.appendChild(panel);

    const focusables = (): HTMLElement[] =>
      [btnAllowOnce, btnAlways, btnCancel].filter((el) => !el.hasAttribute('disabled'));

    let settled = false;
    const finish = (value: ToolApprovalModalResult): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onDocKeyDown, true);
      panel.removeEventListener('keydown', onPanelKeyDown);
      mainColumn?.classList.remove('main-column--tool-approval-pending');
      host.replaceChildren();
      host.hidden = true;
      if (msgInput) msgInput.disabled = prevInputDisabled;
      if (sendBtn) sendBtn.disabled = prevSendDisabled;
      msgInput?.focus();
      resolve(value);
    };

    const onDocKeyDown = (ev: KeyboardEvent): void => {
      if (host.hidden) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        finish('cancel');
        return;
      }
      const digit = digitHotkeyChoice(ev);
      if (digit === null) return;
      // Same visibility as Esc: digits work while the strip is open. Skip only if the user
      // is typing in another field (composer is disabled here, so focus is often on <body>).
      if (isTypingOutsideApprovalHost(host, document.activeElement)) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (digit === 1) finish('allow-once');
      else if (digit === 2) finish('always-allow');
      else finish('cancel');
    };

    const onPanelKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Tab') return;
      const nodes = focusables();
      if (nodes.length === 0) return;
      const i = nodes.indexOf(document.activeElement as HTMLElement);
      const from = i >= 0 ? i : 0;
      ev.preventDefault();
      const next =
        ev.shiftKey ?
          nodes[(from - 1 + nodes.length) % nodes.length]
        : nodes[(from + 1) % nodes.length];
      next.focus();
    };

    btnAllowOnce.addEventListener('click', () => finish('allow-once'));
    btnAlways.addEventListener('click', () => finish('always-allow'));
    btnCancel.addEventListener('click', () => finish('cancel'));

    document.addEventListener('keydown', onDocKeyDown, true);
    panel.addEventListener('keydown', onPanelKeyDown);

    requestAnimationFrame(() => {
      btnAllowOnce.focus();
      host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });
}
