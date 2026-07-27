import { createOsIcon, type OsIconName } from './icons';

/** Window chrome control kinds shared by floating windows and the shell menubar. */
export type WindowControlKind = 'minimize' | 'maximize' | 'restore' | 'close';

function iconNameForKind(kind: WindowControlKind): OsIconName {
  return kind;
}

/** Create a Minnow Shell window control button (`.mn-os-window-btn`). */
export function createWindowControlButton(
  kind: WindowControlKind,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `mn-os-window-btn mn-os-window-btn--${kind}`;
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.appendChild(createOsIcon(iconNameForKind(kind), { size: 14 }));
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onClick();
  });
  return btn;
}

/** Swap maximize/restore icon and accessible name on an existing control button. */
export function setWindowControlButtonKind(
  btn: HTMLButtonElement,
  kind: WindowControlKind,
  label: string,
): void {
  btn.className = `mn-os-window-btn mn-os-window-btn--${kind}`;
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.replaceChildren(createOsIcon(iconNameForKind(kind), { size: 14 }));
}
