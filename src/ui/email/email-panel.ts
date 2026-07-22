import { appAlert, appConfirm, appPrompt } from '../app-dialog';
/**
 * Email inbox + thread panel for the MinnowOS Email app.
 */

import {
  createEmailAccount,
  deleteEmailAccount,
  fetchEmailAccounts,
  updateEmailAccount,
  type EmailAccount,
} from '../../email/client';
import { subscribeEmailEvents } from '../../email/client-ext';
import { renderEmailDashboard } from './email-dashboard';
import { renderEmailLayout } from './email-layout';
import { renderEmailAutomations } from './email-automations';
import { EMAIL_ICONS } from './email-icons';
import {
  ACCOUNT_DOT_CLASSES,
  ALL_INBOXES,
  accountColorIndex,
  renderUnifiedInbox,
} from './email-unified';

/** Unsubscribe handles for SSE listeners keyed by panel mount element. */
const panelEventUnsubs = new WeakMap<HTMLElement, () => void>();

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

/** Human provider label for the active account chip in the chrome header. */
function accountProviderLabel(account: EmailAccount): string {
  const host = account.imap.host.toLowerCase();
  if (host.includes('gmail') || host.includes('google')) return 'Gmail';
  if (host.includes('outlook') || host.includes('office365')) return 'Outlook';
  if (host.includes('fastmail')) return 'Fastmail';
  return account.imap.host;
}

/**
 * Map an IMAP/connection error to the account-form field worth highlighting.
 *
 * The messages come from `server/email/imap-errors.js`; this only needs to be
 * good enough to point at the field the user can actually fix — credentials
 * versus reachability — so an auth failure lands them on the password, not a
 * toast they have to decode.
 */
function classifyAccountFieldError(message: string): { field: string } | null {
  const text = message.toLowerCase();
  if (/authentication failed|app password|basic authentication|rejected the login|password|credential/.test(text)) {
    return { field: 'password' };
  }
  if (/could not connect|could not reach|was reset|refused|etimedout|enotfound|econnrefused|check host/.test(text)) {
    return { field: 'imapHost' };
  }
  return null;
}

/** Icon-only chrome control with accessible name. */
function chromeIconBtn(icon: string, label: string): HTMLButtonElement {
  const btn = el('button', 'email-chrome-icon-btn') as HTMLButtonElement;
  btn.type = 'button';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = icon;
  return btn;
}

interface AccountFormOptions extends EmailPanelOptions {
  title?: string;
  /** When set, form edits this account instead of creating a new one. */
  existing?: EmailAccount;
  /** First account becomes default automatically when none exist yet. */
  isFirstAccount?: boolean;
  /** Total configured accounts — used for sign-out confirmation copy. */
  accountCount?: number;
  /** Deep-link target: field id (e.g. 'password') to mark invalid on open. */
  highlightField?: string;
  /** The error to show against the highlighted field. */
  errorMessage?: string;
  onSaved: () => void;
  onCancel?: () => void;
  onSignedOut?: () => void;
}

/** Build the confirmation copy before removing a stored email account. */
function signOutConfirmMessage(account: EmailAccount, accountCount: number): string {
  const identity = `"${account.label}" (${account.username})`;
  if (accountCount > 1) {
    return `Sign out of ${identity}? This device will stop syncing mail for this account and remove its cached messages.`;
  }
  return `Sign out of ${identity}? You will need to connect again to use Email. Cached messages on this device will be removed.`;
}

/** Confirm and delete a stored email account (sign out). */
async function signOutEmailAccount(
  account: EmailAccount,
  accountCount: number,
  options: EmailPanelOptions,
): Promise<boolean> {
  if (!await appConfirm(signOutConfirmMessage(account, accountCount))) {
    return false;
  }
  try {
    await deleteEmailAccount(account.id);
    options.onStatus?.('ok', 'Signed out');
    return true;
  } catch (err) {
    options.onStatus?.('err', err instanceof Error ? err.message : 'Sign out failed');
    return false;
  }
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
        : 'Connect via IMAP (Gmail app passwords, Fastmail, iCloud, etc.). SMTP is optional for send.',
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

  // Signature is only offered when editing: it is noise during the initial
  // connect, when the user is trying to get mail flowing at all.
  if (editing) {
    const signatureRow = el('label', 'email-field');
    signatureRow.appendChild(el('span', 'email-field-label', 'Signature (optional)'));
    const signatureInput = el('textarea', 'email-input email-signature-input') as HTMLTextAreaElement;
    signatureInput.id = 'email-signature';
    signatureInput.name = 'signature';
    signatureInput.rows = 3;
    signatureInput.placeholder = 'Appended below new messages';
    signatureInput.value = existing?.signature ?? '';
    signatureRow.appendChild(signatureInput);
    form.appendChild(signatureRow);
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

    const checkboxRow = (
      name: string,
      label: string,
      checked: boolean,
      title: string,
    ): void => {
      const row = el('label', 'email-field email-field-checkbox');
      row.title = title;
      const input = el('input') as HTMLInputElement;
      input.type = 'checkbox';
      input.name = name;
      input.id = `email-${name}`;
      input.checked = checked;
      row.appendChild(input);
      row.appendChild(el('span', 'email-field-label', label));
      form.appendChild(row);
    };

    checkboxRow(
      'followupTracking',
      'Track sent mail awaiting replies',
      existing.followupTracking !== false,
      'Classify sent mail that expects an answer and surface it as "Waiting on"',
    );
    checkboxRow(
      'styleProfileEnabled',
      'AI writing-style profile (opt-in)',
      existing.styleProfileEnabled === true,
      'Distill a local style card from mail you wrote so AI drafts sound like you',
    );
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

  if (editing && existing && options.onSignedOut) {
    const signOutZone = el('div', 'email-setup-signout');
    const signOutBtn = el('button', 'email-btn email-btn-danger', 'Sign out') as HTMLButtonElement;
    signOutBtn.type = 'button';
    signOutBtn.addEventListener('click', async () => {
      signOutBtn.disabled = true;
      const signedOut = await signOutEmailAccount(
        existing,
        options.accountCount ?? 1,
        options,
      );
      if (signedOut) {
        options.onSignedOut();
      } else {
        signOutBtn.disabled = false;
      }
    });
    signOutZone.appendChild(signOutBtn);
    form.appendChild(signOutZone);
  }

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
      signature: String(data.get('signature') ?? existing?.signature ?? ''),
      folders: existing?.folders ?? ['INBOX'],
      pollingEnabled: existing?.pollingEnabled ?? false,
      pollingIntervalMinutes: existing?.pollingIntervalMinutes ?? 15,
      isDefault: editing
        ? data.get('isDefault') === 'on'
        : Boolean(options.isFirstAccount),
      ...(editing
        ? {
            followupTracking: data.get('followupTracking') === 'on',
            styleProfileEnabled: data.get('styleProfileEnabled') === 'on',
          }
        : {}),
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

  // Deep-link from a connection error: mark the offending field, explain why,
  // and put the cursor on it so the fix is one keystroke away.
  if (options.highlightField) {
    const input = card.querySelector<HTMLInputElement>(`#email-${options.highlightField}`);
    const row = input?.closest('.email-field');
    if (input && row) {
      row.classList.add('is-error');
      if (options.errorMessage) {
        const msg = el('p', 'email-field-error', options.errorMessage);
        msg.id = `email-${options.highlightField}-error`;
        input.setAttribute('aria-describedby', msg.id);
        input.setAttribute('aria-invalid', 'true');
        row.appendChild(msg);
      }
      input.focus();
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
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
    mount.replaceChildren(wrap);
    renderAccountForm(wrap, {
      ...options,
      title: 'Connect an email account',
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

  let activeAccount = accounts.find((row) => row.isDefault) ?? accounts[0];

  /** True when the list is showing every mailbox at once. */
  let unified = false;

  /**
   * Status pass-through that also deep-links auth/connection failures to the
   * account form with the offending field highlighted — the difference between
   * a dead-end toast and a one-step fix.
   */
  const handleStatus = (state: 'ok' | 'err', message: string): void => {
    options.onStatus?.(state, message);
    if (state !== 'err' || unified || accountFormMode !== 'none') return;
    const hit = classifyAccountFieldError(message);
    if (hit) openAccountSetup('edit', { highlightField: hit.field, errorMessage: message });
  };

  const shell = el('div', 'email-shell email-shell-agent');
  const chrome = el('header', 'email-chrome');
  const body = el('div', 'email-body email-body-fill');
  // The body is the tab panel; -1 lets focus land here on a view switch.
  body.id = 'email-view-panel';
  body.setAttribute('role', 'tabpanel');
  body.tabIndex = -1;

  // Announces the active view to assistive tech when tabs change.
  const liveRegion = el('div', 'visually-hidden');
  liveRegion.setAttribute('aria-live', 'polite');

  // A hairline progress bar under the chrome carries sync state, replacing the
  // disabled-button-as-status pattern. Ref-counted so overlapping syncs (manual
  // + background) keep it lit until the last one finishes.
  const syncBar = el('div', 'email-sync-bar');
  syncBar.setAttribute('role', 'progressbar');
  syncBar.setAttribute('aria-label', 'Syncing mail');
  syncBar.setAttribute('aria-hidden', 'true');
  let syncDepth = 0;
  const setSyncing = (active: boolean): void => {
    syncDepth = Math.max(0, syncDepth + (active ? 1 : -1));
    const on = syncDepth > 0;
    syncBar.classList.toggle('is-active', on);
    syncBar.setAttribute('aria-hidden', on ? 'false' : 'true');
  };

  const identity = el('div', 'email-chrome-identity');
  identity.appendChild(el('p', 'email-chrome-kicker', 'Email'));

  const accountWrap = el('div', 'email-chrome-account');

  // A colour dot mirrors the per-account dots in the unified list, so a mailbox
  // reads the same in the chrome as it does in "All inboxes". Only meaningful
  // once there is more than one mailbox.
  const accountDots = el('div', 'email-chrome-account-dots');
  const paintAccountDots = (): void => {
    accountDots.replaceChildren();
    if (accounts.length < 2) return;
    const ids = unified ? accounts.map((row) => row.id) : [activeAccount.id];
    for (const id of ids) {
      const dot = el(
        'span',
        `email-account-dot ${ACCOUNT_DOT_CLASSES[accountColorIndex(accounts, id)]}`,
      );
      dot.title = accounts.find((row) => row.id === id)?.label ?? '';
      accountDots.appendChild(dot);
    }
  };

  const accountSelect = el('select', 'email-chrome-account-select') as HTMLSelectElement;
  accountSelect.setAttribute('aria-label', 'Active email account');

  // Only offered when there is more than one mailbox to unify.
  if (accounts.length > 1) {
    const allOpt = el('option') as HTMLOptionElement;
    allOpt.value = ALL_INBOXES;
    allOpt.textContent = 'All inboxes';
    accountSelect.appendChild(allOpt);
  }

  for (const account of accounts) {
    const opt = el('option') as HTMLOptionElement;
    opt.value = account.id;
    opt.textContent = account.label;
    opt.selected = account.id === activeAccount.id;
    accountSelect.appendChild(opt);
  }
  const accountHint = el(
    'span',
    'email-chrome-account-hint',
    `${accountProviderLabel(activeAccount)} · ${activeAccount.username}`,
  );
  accountWrap.appendChild(accountDots);
  accountWrap.appendChild(accountSelect);
  accountWrap.appendChild(accountHint);
  identity.appendChild(accountWrap);
  paintAccountDots();

  const nav = el('nav', 'email-chrome-nav');
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'Email views');
  const segments = el('div', 'email-chrome-segments');

  const mkViewTab = (mode: EmailViewMode, label: string, icon: string) => {
    const btn = el('button', 'email-chrome-segment') as HTMLButtonElement;
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.id = `email-tab-${mode}`;
    btn.setAttribute('aria-controls', 'email-view-panel');
    btn.dataset.view = mode;
    // Roving tabindex: only the active tab is a Tab stop; arrows move within.
    btn.tabIndex = -1;
    btn.innerHTML = `${icon}<span class="email-chrome-segment-label">${label}</span>`;
    return btn;
  };

  const dashBtn = mkViewTab('dashboard', 'Dashboard', EMAIL_ICONS.dashboard);
  const mailBtn = mkViewTab('mail', 'Mail', EMAIL_ICONS.mail);
  const autoBtn = mkViewTab('automations', 'Automations', EMAIL_ICONS.automations);
  segments.appendChild(dashBtn);
  segments.appendChild(mailBtn);
  segments.appendChild(autoBtn);
  nav.appendChild(segments);

  const utils = el('div', 'email-chrome-utils');
  const settingsBtn = chromeIconBtn(EMAIL_ICONS.settings, 'Account settings');
  utils.appendChild(settingsBtn);

  chrome.appendChild(identity);
  chrome.appendChild(nav);
  chrome.appendChild(utils);

  shell.appendChild(chrome);
  shell.appendChild(syncBar);
  shell.appendChild(body);
  shell.appendChild(liveRegion);
  mount.replaceChildren(shell);

  const viewTabs = [dashBtn, mailBtn, autoBtn];
  const VIEW_LABELS: Record<EmailViewMode, string> = {
    dashboard: 'Dashboard',
    mail: 'Mail',
    automations: 'Automations',
    setup: 'Account settings',
  };

  const setActiveTab = (mode: EmailViewMode) => {
    viewMode = mode;
    for (const btn of viewTabs) {
      const active = btn.dataset.view === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    }
    body.setAttribute('aria-labelledby', `email-tab-${mode}`);
  };

  setActiveTab(viewMode);

  /** Switch views from a tab: render, then announce so SR users hear it. */
  const activateTab = (mode: EmailViewMode): void => {
    setActiveTab(mode);
    liveRegion.textContent = `${VIEW_LABELS[mode]} view`;
    void renderView();
  };

  const renderView = async () => {
    if (accountFormMode !== 'none') {
      return;
    }
    body.replaceChildren(el('p', 'email-loading', 'Loading…'));
    if (viewMode === 'dashboard') {
      await renderEmailDashboard(body, {
        account: activeAccount,
        onStatus: handleStatus,
        onSyncActivity: setSyncing,
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
      if (unified) {
        await renderUnifiedInbox(body, {
          accounts,
          onStatus: handleStatus,
          // Opening a message drops back into that mailbox's full surface,
          // which is where reply, move and the rest actually live.
          onOpen: (message) => {
            const owner = accounts.find((row) => row.id === message.accountId);
            if (!owner) return;
            unified = false;
            activeAccount = owner;
            accountSelect.value = owner.id;
            accountHint.textContent = `${accountProviderLabel(owner)} · ${owner.username}`;
            paintAccountDots();
            pendingThreadId = message.threadId;
            void renderView();
          },
        });
        return;
      }

      await renderEmailLayout(body, {
        account: activeAccount,
        initialThreadId: pendingThreadId,
        onStatus: handleStatus,
        onSyncActivity: setSyncing,
      });
      pendingThreadId = undefined;
      return;
    }
    if (viewMode === 'automations') {
      await renderEmailAutomations(body, {
        account: activeAccount,
        onStatus: handleStatus,
        onClose: () => {
          setActiveTab('dashboard');
          void renderView();
        },
      });
    }
  };

  dashBtn.addEventListener('click', () => activateTab('dashboard'));
  mailBtn.addEventListener('click', () => activateTab('mail'));
  autoBtn.addEventListener('click', () => activateTab('automations'));

  // Arrow / Home / End move between tabs and activate, per the WAI-ARIA tabs
  // pattern; focus follows the roving tabindex set in setActiveTab.
  segments.addEventListener('keydown', (event) => {
    const current = viewTabs.findIndex((btn) => btn.dataset.view === viewMode);
    let nextIndex = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (current + 1) % viewTabs.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (current - 1 + viewTabs.length) % viewTabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = viewTabs.length - 1;
    }
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextBtn = viewTabs[nextIndex];
    activateTab(nextBtn.dataset.view as EmailViewMode);
    nextBtn.focus();
  });

  accountSelect.addEventListener('change', () => {
    if (accountSelect.value === ALL_INBOXES) {
      unified = true;
      accountHint.textContent = `${accounts.length} mailboxes`;
      paintAccountDots();
      void renderView();
      return;
    }

    const next = accounts.find((row) => row.id === accountSelect.value);
    if (!next) return;
    unified = false;
    activeAccount = next;
    accountHint.textContent = `${accountProviderLabel(next)} · ${next.username}`;
    paintAccountDots();
    void renderView();
  });

  const openAccountSetup = (
    mode: 'add' | 'edit',
    deepLink?: { highlightField?: string; errorMessage?: string },
  ) => {
    accountFormMode = mode;
    body.replaceChildren();
    if (mode === 'add') {
      renderAccountForm(body, {
        ...options,
        title: 'Add email account',
        isFirstAccount: false,
        onSaved: () => void renderEmailPanel(mount, options),
        onCancel: () => {
          accountFormMode = 'none';
          void renderView();
        },
      });
      return;
    }
    // The settings button reads as active whenever the edit form is open,
    // including when a connection error opened it.
    settingsBtn.classList.add('is-active');
    renderAccountForm(body, {
      ...options,
      title: 'Edit email account',
      existing: activeAccount,
      accountCount: accounts.length,
      highlightField: deepLink?.highlightField,
      errorMessage: deepLink?.errorMessage,
      onSaved: () => void renderEmailPanel(mount, options),
      onSignedOut: () => void renderEmailPanel(mount, options),
      onCancel: () => {
        accountFormMode = 'none';
        settingsBtn.classList.remove('is-active');
        void renderView();
      },
    });
  };

  settingsBtn.addEventListener('click', () => {
    if (accountFormMode === 'edit') {
      accountFormMode = 'none';
      settingsBtn.classList.remove('is-active');
      void renderView();
      return;
    }
    openAccountSetup('edit');
    settingsBtn.classList.add('is-active');
  });

  panelEventUnsubs.get(mount)?.();
  panelEventUnsubs.set(
    mount,
    subscribeEmailEvents((type, payload) => {
      if (payload.accountId && payload.accountId !== activeAccount.id) {
        return;
      }
      if (
        type === 'summary_updated' ||
        type === 'message_new' ||
        type === 'digest_updated' ||
        type === 'pending_actions_updated' ||
        type === 'followups_updated'
      ) {
        if (viewMode === 'dashboard') {
          void renderView();
        }
      }
    }),
  );

  await renderView();
}
