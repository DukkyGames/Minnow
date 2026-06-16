/**
 * Email inbox + thread panel for the MinnowOS Email app.
 */

import {
  createEmailAccount,
  fetchEmailAccounts,
  testEmailAccount,
  updateEmailAccount,
  type EmailAccount,
} from '../../email/client';
import { subscribeEmailEvents } from '../../email/client-ext';
import { mountOAuthConnectPanel } from '../oauth-connect';
import { renderEmailDashboard } from './email-dashboard';
import { renderEmailLayout } from './email-layout';
import { renderEmailAutomations } from './email-automations';

export interface EmailPanelOptions {
  onStatus?: (state: 'ok' | 'err', message: string) => void;
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

/** Expand the IMAP setup form and scroll it into view. */
function revealImapSetup(manualMount: HTMLElement): void {
  manualMount.classList.remove('email-manual-mount--hidden');
  manualMount.classList.add('email-manual-mount--highlight');
  manualMount.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  window.setTimeout(() => {
    manualMount.classList.remove('email-manual-mount--highlight');
  }, 1600);
}

interface AccountFormOptions extends EmailPanelOptions {
  title?: string;
  /** When set, form edits this account instead of creating a new one. */
  existing?: EmailAccount;
  /** First account becomes default automatically when none exist yet. */
  isFirstAccount?: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}

/** Render create- or edit-account form. */
function renderAccountForm(mount: HTMLElement, options: AccountFormOptions): void {
  const editing = Boolean(options.existing);
  mount.replaceChildren();
  const card = el('section', 'email-setup-card');
  card.appendChild(
    el(
      'h3',
      'email-setup-title',
      options.title ?? (editing ? 'Edit email account' : 'Connect an email account'),
    ),
  );
  card.appendChild(
    el(
      'p',
      'email-setup-note',
      editing
        ? 'Update connection settings. Leave the password blank to keep the current one.'
        : 'IMAP read-only triage first. Many Outlook tenants block basic auth — use Gmail app passwords or Fastmail. SMTP is optional for send.',
    ),
  );

  const existing = options.existing;
  const form = el('form', 'email-setup-form');
  const fields: Array<{ id: string; label: string; type?: string; value?: string; placeholder?: string }> = [
    { id: 'label', label: 'Account label', value: existing?.label },
    { id: 'username', label: 'Email / username', value: existing?.username },
    {
      id: 'password',
      label: editing ? 'New password (optional)' : 'Password / app password',
      type: 'password',
      placeholder: editing ? 'Leave blank to keep current password' : undefined,
    },
    {
      id: 'imapHost',
      label: 'IMAP host',
      value: existing?.imap.host ?? 'imap.gmail.com',
    },
    {
      id: 'imapPort',
      label: 'IMAP port',
      value: String(existing?.imap.port ?? 993),
    },
    {
      id: 'smtpHost',
      label: 'SMTP host (optional)',
      value: existing?.smtp?.host ?? (editing ? '' : 'smtp.gmail.com'),
    },
    {
      id: 'smtpPort',
      label: 'SMTP port (optional)',
      value: String(existing?.smtp?.port ?? 587),
    },
  ];

  for (const field of fields) {
    const row = el('label', 'email-field');
    row.appendChild(el('span', 'email-field-label', field.label));
    const input = el('input', 'email-input') as HTMLInputElement;
    input.id = `email-${field.id}`;
    input.name = field.id;
    if (field.type) input.type = field.type;
    if (field.value) input.value = field.value;
    if (field.placeholder) input.placeholder = field.placeholder;
    if (!editing && field.id === 'password') input.required = true;
    row.appendChild(input);
    form.appendChild(row);
  }

  if (editing && existing) {
    const defaultRow = el('label', 'email-field email-field-checkbox');
    const defaultInput = el('input') as HTMLInputElement;
    defaultInput.type = 'checkbox';
    defaultInput.name = 'isDefault';
    defaultInput.id = 'email-isDefault';
    defaultInput.checked = existing.isDefault;
    defaultRow.appendChild(defaultInput);
    defaultRow.appendChild(el('span', 'email-field-label', 'Default account'));
    form.appendChild(defaultRow);
  }

  const actions = el('div', 'email-actions');
  if (options.onCancel) {
    const cancelBtn = el('button', 'email-btn', 'Cancel') as HTMLButtonElement;
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', options.onCancel);
    actions.appendChild(cancelBtn);
  }
  const saveBtn = el(
    'button',
    'email-btn email-btn-primary',
    editing ? 'Save changes' : 'Save account',
  ) as HTMLButtonElement;
  saveBtn.type = 'submit';
  actions.appendChild(saveBtn);
  form.appendChild(actions);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const smtpHost = String(data.get('smtpHost') ?? '').trim();
    const password = String(data.get('password') ?? '');
    const payload: Record<string, unknown> = {
      label: String(data.get('label') ?? '').trim(),
      username: String(data.get('username') ?? '').trim(),
      imap: {
        host: String(data.get('imapHost') ?? '').trim(),
        port: Number(data.get('imapPort') ?? 993),
        tls: existing?.imap.tls ?? true,
      },
      smtp: smtpHost
        ? {
            host: smtpHost,
            port: Number(data.get('smtpPort') ?? 587),
            starttls: existing?.smtp?.starttls ?? true,
          }
        : undefined,
      folders: existing?.folders ?? ['INBOX'],
      pollingEnabled: existing?.pollingEnabled ?? false,
      pollingIntervalMinutes: existing?.pollingIntervalMinutes ?? 15,
      isDefault: editing
        ? data.get('isDefault') === 'on'
        : Boolean(options.isFirstAccount),
    };
    if (password.trim()) {
      payload.password = password;
    }

    try {
      if (editing && existing) {
        await updateEmailAccount(existing.id, payload);
        options.onStatus?.('ok', 'Account updated');
      } else {
        if (!password.trim()) {
          options.onStatus?.('err', 'Password is required');
          return;
        }
        await createEmailAccount({ ...payload, password });
        options.onStatus?.('ok', 'Account saved');
      }
      options.onSaved();
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'Save failed');
    }
  });

  card.appendChild(form);
  mount.appendChild(card);
}

type EmailViewMode = 'dashboard' | 'mail' | 'automations' | 'setup';

/** Main panel entry — dashboard default, mail view, automations. */
export async function renderEmailPanel(
  mount: HTMLElement,
  options: EmailPanelOptions = {},
): Promise<void> {
  mount.replaceChildren(el('p', 'email-loading', 'Loading…'));

  let accounts: EmailAccount[];
  try {
    accounts = await fetchEmailAccounts();
  } catch (err) {
    mount.replaceChildren(
      el('p', 'email-empty is-err', err instanceof Error ? err.message : 'Failed to load accounts'),
    );
    return;
  }

  if (accounts.length === 0) {
    const wrap = el('div', 'email-setup-shell');
    const oauthMount = el('div', 'email-oauth-mount');
    wrap.appendChild(oauthMount);
    const manualMount = el('div', 'email-manual-mount email-manual-mount--hidden');
    wrap.appendChild(manualMount);
    mount.replaceChildren(wrap);
    await mountOAuthConnectPanel({
      mount: oauthMount,
      onStatus: options.onStatus,
      showImapAlternative: true,
      onShowImap: () => {
        revealImapSetup(manualMount);
      },
      onChange: () => {
        void renderEmailPanel(mount, options);
      },
    });
    renderAccountForm(manualMount, {
      ...options,
      title: 'Connect with IMAP',
      isFirstAccount: true,
      onSaved: () => {
        void renderEmailPanel(mount, options);
      },
    });
    return;
  }

  let accountFormMode: 'none' | 'add' | 'edit' = 'none';
  let viewMode: EmailViewMode = 'dashboard';
  let pendingThreadId: string | undefined;
  let unsubscribeEvents: (() => void) | undefined;

  let activeAccount = accounts.find((row) => row.isDefault) ?? accounts[0];

  const shell = el('div', 'email-shell email-shell-agent');
  const chrome = el('header', 'email-chrome');
  const body = el('div', 'email-body email-body-fill');

  const accountSelect = el('select', 'email-select') as HTMLSelectElement;
  for (const account of accounts) {
    const opt = el('option') as HTMLOptionElement;
    opt.value = account.id;
    opt.textContent = account.label;
    opt.selected = account.id === activeAccount.id;
    accountSelect.appendChild(opt);
  }
  chrome.appendChild(accountSelect);

  const dashBtn = el('button', 'email-chrome-tab is-active', 'Dashboard') as HTMLButtonElement;
  const mailBtn = el('button', 'email-chrome-tab', 'Mail') as HTMLButtonElement;
  const autoBtn = el('button', 'email-chrome-tab', 'Automations') as HTMLButtonElement;
  dashBtn.type = 'button';
  mailBtn.type = 'button';
  autoBtn.type = 'button';

  const settingsBtn = el('button', 'email-btn', 'Accounts') as HTMLButtonElement;
  settingsBtn.type = 'button';
  const testBtn = el('button', 'email-btn', 'Test') as HTMLButtonElement;
  testBtn.type = 'button';

  chrome.appendChild(dashBtn);
  chrome.appendChild(mailBtn);
  chrome.appendChild(autoBtn);
  chrome.appendChild(settingsBtn);
  chrome.appendChild(testBtn);

  shell.appendChild(chrome);
  shell.appendChild(body);
  mount.replaceChildren(shell);

  const setActiveTab = (mode: EmailViewMode) => {
    viewMode = mode;
    dashBtn.classList.toggle('is-active', mode === 'dashboard');
    mailBtn.classList.toggle('is-active', mode === 'mail');
    autoBtn.classList.toggle('is-active', mode === 'automations');
  };

  const renderView = async () => {
    if (accountFormMode !== 'none') {
      return;
    }
    body.replaceChildren(el('p', 'email-loading', 'Loading…'));
    if (viewMode === 'dashboard') {
      await renderEmailDashboard(body, {
        account: activeAccount,
        onStatus: options.onStatus,
        onRefresh: () => void renderView(),
        onOpenThread: (threadId) => {
          pendingThreadId = threadId;
          setActiveTab('mail');
          void renderView();
        },
        onOpenMail: () => {
          pendingThreadId = undefined;
          setActiveTab('mail');
          void renderView();
        },
      });
      return;
    }
    if (viewMode === 'mail') {
      await renderEmailLayout(body, {
        account: activeAccount,
        initialThreadId: pendingThreadId,
        onStatus: options.onStatus,
      });
      pendingThreadId = undefined;
      return;
    }
    if (viewMode === 'automations') {
      await renderEmailAutomations(body, {
        account: activeAccount,
        onStatus: options.onStatus,
        onClose: () => {
          setActiveTab('dashboard');
          void renderView();
        },
      });
    }
  };

  dashBtn.addEventListener('click', () => {
    setActiveTab('dashboard');
    void renderView();
  });
  mailBtn.addEventListener('click', () => {
    setActiveTab('mail');
    void renderView();
  });
  autoBtn.addEventListener('click', () => {
    setActiveTab('automations');
    void renderView();
  });

  accountSelect.addEventListener('change', () => {
    const next = accounts.find((row) => row.id === accountSelect.value);
    if (!next) return;
    activeAccount = next;
    void renderView();
  });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    try {
      await testEmailAccount(activeAccount.id);
      options.onStatus?.('ok', 'Connection OK');
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'Test failed');
    } finally {
      testBtn.disabled = false;
    }
  });

  const openAccountSetup = (mode: 'add' | 'edit') => {
    accountFormMode = mode;
    body.replaceChildren();
    if (mode === 'add') {
      const oauthMount = el('div', 'email-oauth-mount');
      body.appendChild(oauthMount);
      const formMount = el('div', 'email-manual-mount email-manual-mount--hidden');
      body.appendChild(formMount);
      void mountOAuthConnectPanel({
        mount: oauthMount,
        onStatus: options.onStatus,
        showImapAlternative: true,
        onShowImap: () => revealImapSetup(formMount),
        onChange: () => void renderEmailPanel(mount, options),
      });
      renderAccountForm(formMount, {
        ...options,
        title: 'Connect with IMAP',
        isFirstAccount: false,
        onSaved: () => void renderEmailPanel(mount, options),
        onCancel: () => {
          accountFormMode = 'none';
          void renderView();
        },
      });
      return;
    }
    renderAccountForm(body, {
      ...options,
      title: 'Edit email account',
      existing: activeAccount,
      onSaved: () => void renderEmailPanel(mount, options),
      onCancel: () => {
        accountFormMode = 'none';
        void renderView();
      },
    });
  };

  settingsBtn.addEventListener('click', () => {
    if (accountFormMode === 'edit') {
      accountFormMode = 'none';
      void renderView();
      return;
    }
    openAccountSetup('edit');
  });

  unsubscribeEvents?.();
  unsubscribeEvents = subscribeEmailEvents((type, payload) => {
    if (payload.accountId && payload.accountId !== activeAccount.id) {
      return;
    }
    if (type === 'summary_updated' || type === 'message_new') {
      if (viewMode === 'dashboard') {
        void renderView();
      }
    }
  });

  await renderView();
}
