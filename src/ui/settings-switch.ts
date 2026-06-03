/**
 * Settings toggle switches (replaces native checkboxes in settings UI).
 */

export type SettingsSwitchOptions = {
  id?: string;
  name?: string;
  checked?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  /** Scroll target for the settings global finder. */
  searchKey?: string;
  onChange?: (checked: boolean) => void;
};

/** Visual switch; underlying control remains a checkbox for forms and bindings. */
export function createSettingsSwitch(
  options: SettingsSwitchOptions = {},
): { root: HTMLLabelElement; input: HTMLInputElement } {
  const root = document.createElement('label');
  root.className = 'settings-switch';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'settings-switch__input';
  input.setAttribute('role', 'switch');
  if (options.id) input.id = options.id;
  if (options.name) input.name = options.name;
  if (options.checked) input.checked = true;
  if (options.disabled) input.disabled = true;
  if (options.ariaLabel) input.setAttribute('aria-label', options.ariaLabel);

  const track = document.createElement('span');
  track.className = 'settings-switch__track';
  const thumb = document.createElement('span');
  thumb.className = 'settings-switch__thumb';
  track.appendChild(thumb);

  root.appendChild(input);
  root.appendChild(track);

  if (options.onChange) {
    input.addEventListener('change', () => options.onChange!(input.checked));
  }

  return { root, input };
}

/** Label on the left, switch on the right (standard settings row). */
export function createSettingsToggleRow(
  labelText: string,
  options: SettingsSwitchOptions = {},
): { row: HTMLDivElement; input: HTMLInputElement } {
  const row = document.createElement('div');
  row.className = 'settings-toggle-row';
  if (options.searchKey) {
    row.dataset.settingsSearchKey = options.searchKey;
  }

  const label = document.createElement('span');
  label.className = 'settings-toggle-row__label';
  label.textContent = labelText;
  if (options.id) label.id = `${options.id}-label`;

  const { root, input } = createSettingsSwitch(options);
  row.append(label, root);
  return { row, input };
}

function copyInputState(from: HTMLInputElement, to: HTMLInputElement): void {
  for (const attr of ['id', 'name', 'checked', 'disabled'] as const) {
    if (attr === 'checked' || attr === 'disabled') {
      to[attr] = from[attr];
      continue;
    }
    const value = from.getAttribute(attr);
    if (value != null) to.setAttribute(attr, value);
  }
  const aria = from.getAttribute('aria-label');
  if (aria) to.setAttribute('aria-label', aria);
  for (const [key, value] of Object.entries(from.dataset)) {
    to.dataset[key] = value;
  }
}

/** Replace a plain checkbox with switch chrome (keeps id and listeners if upgraded before bind). */
export function wrapCheckboxAsSwitch(input: HTMLInputElement): HTMLInputElement {
  if (input.classList.contains('settings-switch__input')) return input;

  const parent = input.parentElement;
  if (!parent) return input;

  const { root, input: switchInput } = createSettingsSwitch();
  copyInputState(input, switchInput);
  switchInput.setAttribute('role', 'switch');

  if (parent.tagName === 'LABEL' && parent.classList.contains('settings-toggle-row')) {
    const text =
      parent.querySelector(':scope > span')?.textContent?.trim() ||
      switchInput.getAttribute('aria-label') ||
      '';
    const row = createSettingsToggleRow(text, {});
    copyInputState(input, row.input);
    if (switchInput.getAttribute('aria-label')) {
      row.input.setAttribute('aria-label', switchInput.getAttribute('aria-label')!);
    }
    parent.replaceWith(row.row);
    input.remove();
    return row.input;
  }

  if (parent.classList.contains('settings-mcp-toggle')) {
    parent.insertBefore(root, input);
    input.remove();
    return switchInput;
  }

  if (parent.classList.contains('settings-checkbox-option')) {
    parent.insertBefore(root, input);
    input.remove();
    return switchInput;
  }

  if (parent.tagName === 'LABEL' && parent.classList.contains('settings-theme-follow')) {
    const text = parent.textContent?.trim() || 'Follow system appearance';
    const row = createSettingsToggleRow(text, {});
    copyInputState(input, row.input);
    parent.replaceWith(row.row);
    input.remove();
    return row.input;
  }

  input.replaceWith(root);
  return switchInput;
}

/** Upgrade static checkboxes under the settings page (call once on init). */
export function upgradeSettingsCheckboxes(root: ParentNode = document): void {
  const scope =
    root instanceof Document
      ? root.getElementById('settingsView') ?? root.body
      : root;

  scope
    .querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]:not(.settings-switch__input)',
    )
    .forEach((input) => {
      if (input.closest('#benchmarkView')) return;
      wrapCheckboxAsSwitch(input);
    });
}
