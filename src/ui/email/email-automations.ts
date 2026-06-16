/**
 * Email automation rules list and simple builder.
 */

import type { EmailAccount, EmailAutomation } from '../../email/client';
import {
  deleteAutomationRule,
  fetchAutomations,
  saveAutomation,
  updateAutomationRule,
} from '../../email/client-ext';

export interface EmailAutomationsOptions {
  account: EmailAccount;
  onStatus?: (state: 'ok' | 'err', message: string) => void;
  onClose: () => void;
}

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

/**
 * Render automation drawer content.
 */
export async function renderEmailAutomations(
  mount: HTMLElement,
  options: EmailAutomationsOptions,
): Promise<void> {
  mount.replaceChildren(el('p', 'email-loading', 'Loading automations…'));
  mount.className = 'email-automations';

  const header = el('div', 'email-automations-head');
  header.appendChild(el('h3', '', 'Email automations'));
  const closeBtn = el('button', 'email-btn', 'Close') as HTMLButtonElement;
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', options.onClose);
  header.appendChild(closeBtn);

  let rules: EmailAutomation[] = [];
  try {
    rules = await fetchAutomations();
  } catch (err) {
    mount.replaceChildren(
      el('p', 'email-empty is-err', err instanceof Error ? err.message : 'Load failed'),
    );
    return;
  }

  const accountRules = rules.filter((row) => row.accountId === options.account.id);
  mount.replaceChildren(header);

  const list = el('div', 'email-automations-list');
  if (accountRules.length === 0) {
    list.appendChild(el('p', 'email-empty', 'No rules yet. Add one to triage or draft on new mail.'));
  }

  for (const rule of accountRules) {
    const row = el('article', 'email-automation-row');
    row.appendChild(el('h4', '', rule.name));
    row.appendChild(el('p', 'email-automation-meta', `${rule.trigger} → ${rule.action}`));

    const toggle = el('button', 'email-btn', rule.enabled ? 'Disable' : 'Enable') as HTMLButtonElement;
    toggle.type = 'button';
    toggle.addEventListener('click', async () => {
      await updateAutomationRule(rule.id, { enabled: !rule.enabled });
      options.onStatus?.('ok', 'Rule updated');
      void renderEmailAutomations(mount, options);
    });

    const remove = el('button', 'email-btn email-btn-danger', 'Delete') as HTMLButtonElement;
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
      await deleteAutomationRule(rule.id);
      options.onStatus?.('ok', 'Rule deleted');
      void renderEmailAutomations(mount, options);
    });

    const actions = el('div', 'email-actions');
    actions.appendChild(toggle);
    actions.appendChild(remove);
    row.appendChild(actions);
    list.appendChild(row);
  }

  mount.appendChild(list);

  const form = el('form', 'email-automation-form');
  form.appendChild(el('h4', '', 'New rule'));

  const nameInput = el('input', 'email-input') as HTMLInputElement;
  nameInput.name = 'name';
  nameInput.placeholder = 'Rule name';
  nameInput.required = true;
  form.appendChild(nameInput);

  const triggerSelect = el('select', 'email-select') as HTMLSelectElement;
  for (const value of ['on_new_message', 'on_high_urgency', 'on_tag_match']) {
    const opt = el('option') as HTMLOptionElement;
    opt.value = value;
    opt.textContent = value.replace(/_/g, ' ');
    triggerSelect.appendChild(opt);
  }
  form.appendChild(triggerSelect);

  const actionSelect = el('select', 'email-select') as HTMLSelectElement;
  for (const value of ['triage', 'generate_variants', 'notify']) {
    const opt = el('option') as HTMLOptionElement;
    opt.value = value;
    opt.textContent = value.replace(/_/g, ' ');
    actionSelect.appendChild(opt);
  }
  form.appendChild(actionSelect);

  const submit = el('button', 'email-btn email-btn-primary', 'Add rule') as HTMLButtonElement;
  submit.type = 'submit';
  form.appendChild(submit);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await saveAutomation({
        name: nameInput.value.trim(),
        accountId: options.account.id,
        trigger: triggerSelect.value as EmailAutomation['trigger'],
        action: actionSelect.value as EmailAutomation['action'],
        enabled: true,
      });
      options.onStatus?.('ok', 'Rule created');
      void renderEmailAutomations(mount, options);
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'Save failed');
    }
  });

  mount.appendChild(form);
}
