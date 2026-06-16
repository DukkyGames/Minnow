/**
 * Email inbox + thread panel for the MinnowOS Email app.
 */

import {
  createEmailAccount,
  deleteEmailAccount,
  draftEmailReply,
  fetchEmailAccounts,
  fetchEmailMessages,
  fetchEmailThread,
  sendEmailMessage,
  syncEmailFolder,
  testEmailAccount,
  triageEmailMessage,
  updateEmailAccount,
  type EmailAccount,
  type EmailMessage,
} from '../../email/client';
import { mountOAuthConnectPanel } from '../oauth-connect';

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

function formatWhen(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function urgencyClass(urgency?: string): string {
  if (urgency === 'high') return 'email-urgency-high';
  if (urgency === 'low') return 'email-urgency-low';
  return 'email-urgency-normal';
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

function renderMessageRow(
  message: EmailMessage,
  onOpen: (message: EmailMessage) => void,
): HTMLElement {
  const row = el('button', 'email-inbox-row');
  row.type = 'button';

  const main = el('div', 'email-inbox-main');
  const subject = el('span', 'email-inbox-subject', message.subject || '(no subject)');
  const from = el('span', 'email-inbox-from', message.from || 'Unknown sender');
  main.appendChild(subject);
  main.appendChild(from);

  if (message.triage?.summary) {
    main.appendChild(el('span', 'email-inbox-summary', message.triage.summary));
  }

  const meta = el('div', 'email-inbox-meta');
  meta.appendChild(el('span', 'email-inbox-date', formatWhen(message.date)));

  if (message.triage?.urgency) {
    const badge = el('span', `email-urgency-badge ${urgencyClass(message.triage.urgency)}`);
    badge.textContent = message.triage.urgency;
    meta.appendChild(badge);
  }

  if (message.triage?.tags?.length) {
    const tags = el('span', 'email-inbox-tags', message.triage.tags.join(' · '));
    meta.appendChild(tags);
  }

  row.appendChild(main);
  row.appendChild(meta);
  row.addEventListener('click', () => onOpen(message));
  return row;
}

async function renderThreadView(
  mount: HTMLElement,
  account: EmailAccount,
  threadId: string,
  options: EmailPanelOptions,
  onBack: () => void,
): Promise<void> {
  mount.replaceChildren();
  const header = el('div', 'email-thread-hdr');
  const backBtn = el('button', 'email-btn', '← Inbox') as HTMLButtonElement;
  backBtn.type = 'button';
  backBtn.addEventListener('click', onBack);
  header.appendChild(backBtn);
  mount.appendChild(header);

  try {
    const { messages } = await fetchEmailThread(account.id, threadId);
    const stack = el('div', 'email-thread-stack');

    for (const message of messages) {
      const card = el('article', 'email-thread-card');
      card.appendChild(el('h4', 'email-thread-subject', message.subject || '(no subject)'));
      const meta = el('p', 'email-thread-meta');
      meta.textContent = `${message.from} · ${formatWhen(message.date)}`;
      card.appendChild(meta);

      if (message.triage) {
        const triage = el('div', 'email-thread-triage');
        triage.appendChild(el('p', '', message.triage.summary));
        if (message.triage.tags.length) {
          triage.appendChild(el('span', 'email-inbox-tags', message.triage.tags.join(' · ')));
        }
        card.appendChild(triage);
      }

      card.appendChild(el('div', 'email-thread-body', message.bodyText ?? message.bodyPreview));
      stack.appendChild(card);
    }

    mount.appendChild(stack);

    const composer = el('section', 'email-composer');
    composer.appendChild(el('h4', '', 'Reply draft'));
    const bodyArea = el('textarea', 'email-composer-body') as HTMLTextAreaElement;
    bodyArea.rows = 8;
    composer.appendChild(bodyArea);

    const draftBtn = el('button', 'email-btn', 'Generate draft') as HTMLButtonElement;
    draftBtn.type = 'button';
    draftBtn.addEventListener('click', async () => {
      try {
        const draft = await draftEmailReply({ accountId: account.id, threadId });
        bodyArea.value = draft.body;
        options.onStatus?.('ok', 'Draft ready — review before sending');
      } catch (err) {
        options.onStatus?.('err', err instanceof Error ? err.message : 'Draft failed');
      }
    });

    const sendBtn = el('button', 'email-btn email-btn-primary', 'Send…') as HTMLButtonElement;
    sendBtn.type = 'button';
    sendBtn.disabled = !account.smtp?.host;
    sendBtn.addEventListener('click', async () => {
      if (!account.smtp?.host) {
        options.onStatus?.('err', 'Configure SMTP on this account to send');
        return;
      }
      const latest = messages[messages.length - 1];
      const draft = await draftEmailReply({ accountId: account.id, threadId });
      if (!bodyArea.value.trim()) {
        bodyArea.value = draft.body;
      }
      const ok = window.confirm(
        `Send this email to ${draft.to}?\n\nSubject: ${draft.subject}\n\nThis cannot be undone.`,
      );
      if (!ok) return;

      try {
        await sendEmailMessage({
          accountId: account.id,
          to: draft.to,
          subject: draft.subject,
          body: bodyArea.value,
          inReplyTo: latest?.messageId,
          references: draft.references,
          confirmed: true,
        });
        options.onStatus?.('ok', 'Email sent');
      } catch (err) {
        options.onStatus?.('err', err instanceof Error ? err.message : 'Send failed');
      }
    });

    const actions = el('div', 'email-actions');
    actions.appendChild(draftBtn);
    actions.appendChild(sendBtn);
    composer.appendChild(actions);
    mount.appendChild(composer);
  } catch (err) {
    mount.appendChild(
      el('p', 'email-empty', err instanceof Error ? err.message : 'Failed to load thread'),
    );
  }
}

/** Main panel entry — accounts, inbox, and thread drill-down. */
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

  let activeAccount = accounts.find((row) => row.isDefault) ?? accounts[0];
  let activeFolder = activeAccount.folders[0] ?? 'INBOX';
  let messages: EmailMessage[] = [];

  const shell = el('div', 'email-shell');
  const toolbar = el('div', 'email-toolbar');

  const accountSelect = el('select', 'email-select') as HTMLSelectElement;
  for (const account of accounts) {
    const opt = el('option') as HTMLOptionElement;
    opt.value = account.id;
    opt.textContent = account.label;
    opt.selected = account.id === activeAccount.id;
    accountSelect.appendChild(opt);
  }

  const folderSelect = el('select', 'email-select') as HTMLSelectElement;
  const refreshFolders = () => {
    folderSelect.replaceChildren();
    for (const folder of activeAccount.folders) {
      const opt = el('option') as HTMLOptionElement;
      opt.value = folder;
      opt.textContent = folder;
      opt.selected = folder === activeFolder;
      folderSelect.appendChild(opt);
    }
  };
  refreshFolders();

  const syncBtn = el('button', 'email-btn', 'Sync') as HTMLButtonElement;
  syncBtn.type = 'button';
  const triageBtn = el('button', 'email-btn', 'Triage visible') as HTMLButtonElement;
  triageBtn.type = 'button';
  const testBtn = el('button', 'email-btn', 'Test IMAP') as HTMLButtonElement;
  testBtn.type = 'button';
  const addAccountBtn = el('button', 'email-btn', 'Add account') as HTMLButtonElement;
  addAccountBtn.type = 'button';
  const editAccountBtn = el('button', 'email-btn', 'Edit account') as HTMLButtonElement;
  editAccountBtn.type = 'button';
  const removeAccountBtn = el('button', 'email-btn email-btn-danger', 'Remove account') as HTMLButtonElement;
  removeAccountBtn.type = 'button';

  toolbar.appendChild(accountSelect);
  toolbar.appendChild(folderSelect);
  toolbar.appendChild(syncBtn);
  toolbar.appendChild(triageBtn);
  toolbar.appendChild(testBtn);
  toolbar.appendChild(addAccountBtn);
  toolbar.appendChild(editAccountBtn);
  toolbar.appendChild(removeAccountBtn);
  shell.appendChild(toolbar);

  const body = el('div', 'email-body');
  shell.appendChild(body);
  mount.replaceChildren(shell);

  const setToolbarFormMode = (formOpen: boolean) => {
    syncBtn.disabled = formOpen;
    triageBtn.disabled = formOpen;
    testBtn.disabled = formOpen;
    removeAccountBtn.disabled = formOpen;
    accountSelect.disabled = formOpen;
    folderSelect.disabled = formOpen;
    addAccountBtn.disabled = accountFormMode === 'edit';
    editAccountBtn.disabled = accountFormMode === 'add';
  };

  const closeAccountForm = () => {
    accountFormMode = 'none';
    addAccountBtn.textContent = 'Add account';
    editAccountBtn.textContent = 'Edit account';
    setToolbarFormMode(false);
    void loadInbox();
  };

  const setAccountFormMode = (mode: 'none' | 'add' | 'edit') => {
    if (mode === 'none') {
      closeAccountForm();
      return;
    }

    accountFormMode = mode;
    addAccountBtn.textContent = mode === 'add' ? 'Cancel' : 'Add account';
    editAccountBtn.textContent = mode === 'edit' ? 'Cancel' : 'Edit account';
    setToolbarFormMode(true);

    if (mode === 'add') {
      body.replaceChildren();
      const oauthMount = el('div', 'email-oauth-mount');
      body.appendChild(oauthMount);
      const formMount = el('div', 'email-manual-mount email-manual-mount--hidden');
      body.appendChild(formMount);
      void mountOAuthConnectPanel({
        mount: oauthMount,
        onStatus: options.onStatus,
        showImapAlternative: true,
        onShowImap: () => {
          revealImapSetup(formMount);
        },
        onChange: () => {
          void renderEmailPanel(mount, options);
        },
      });
      renderAccountForm(formMount, {
        ...options,
        title: 'Connect with IMAP',
        isFirstAccount: false,
        onSaved: () => {
          void renderEmailPanel(mount, options);
        },
        onCancel: closeAccountForm,
      });
      return;
    }

    renderAccountForm(body, {
      ...options,
      title: 'Edit email account',
      existing: activeAccount,
      onSaved: () => {
        void renderEmailPanel(mount, options);
      },
      onCancel: closeAccountForm,
    });
  };

  const loadInbox = async () => {
    body.replaceChildren(el('p', 'email-loading', 'Loading messages…'));
    try {
      const result = await fetchEmailMessages(activeAccount.id, {
        folder: activeFolder,
        limit: 50,
      });
      messages = result.messages;
      const list = el('div', 'email-inbox-list');
      if (messages.length === 0) {
        list.appendChild(
          el('p', 'email-empty', 'No cached messages — click Sync to fetch from IMAP.'),
        );
      } else {
        for (const message of messages) {
          list.appendChild(
            renderMessageRow(message, (row) => {
              void renderThreadView(body, activeAccount, row.threadId, options, () => {
                void loadInbox();
              });
            }),
          );
        }
      }
      body.replaceChildren(list);
    } catch (err) {
      body.replaceChildren(
        el('p', 'email-empty is-err', err instanceof Error ? err.message : 'Inbox load failed'),
      );
    }
  };

  accountSelect.addEventListener('change', () => {
    const next = accounts.find((row) => row.id === accountSelect.value);
    if (!next) return;
    activeAccount = next;
    activeFolder = next.folders[0] ?? 'INBOX';
    refreshFolders();
    void loadInbox();
  });

  folderSelect.addEventListener('change', () => {
    activeFolder = folderSelect.value;
    void loadInbox();
  });

  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    try {
      const result = await syncEmailFolder(activeAccount.id, activeFolder);
      options.onStatus?.('ok', `Synced ${result.synced} messages`);
      await loadInbox();
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'Sync failed');
    } finally {
      syncBtn.disabled = false;
    }
  });

  triageBtn.addEventListener('click', async () => {
    triageBtn.disabled = true;
    try {
      for (const message of messages.slice(0, 10)) {
        await triageEmailMessage(activeAccount.id, message.id);
      }
      options.onStatus?.('ok', 'Triage updated');
      await loadInbox();
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'Triage failed');
    } finally {
      triageBtn.disabled = false;
    }
  });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    try {
      await testEmailAccount(activeAccount.id);
      options.onStatus?.('ok', 'IMAP connection OK');
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'IMAP test failed');
    } finally {
      testBtn.disabled = false;
    }
  });

  addAccountBtn.addEventListener('click', () => {
    setAccountFormMode(accountFormMode === 'add' ? 'none' : 'add');
  });

  editAccountBtn.addEventListener('click', () => {
    setAccountFormMode(accountFormMode === 'edit' ? 'none' : 'edit');
  });

  removeAccountBtn.addEventListener('click', async () => {
    const label = activeAccount.label || activeAccount.username;
    if (!window.confirm(`Remove email account "${label}"? Cached messages for this account will remain until cleared.`)) {
      return;
    }
    removeAccountBtn.disabled = true;
    try {
      await deleteEmailAccount(activeAccount.id);
      options.onStatus?.('ok', 'Account removed');
      void renderEmailPanel(mount, options);
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'Remove failed');
      removeAccountBtn.disabled = false;
    }
  });

  await loadInbox();
}
