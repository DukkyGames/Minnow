import { appAlert, appConfirm, appPrompt } from '../app-dialog';
/**
 * Email inbox + thread panel for the MinnowOS Email app.
 */

import {
  createEmailAccount,
  deleteEmailAccount,
  fetchEmailAccounts,
  fetchEmailPreferences,
  syncEmailFolder,
  updateEmailAccount,
  updateEmailPreferences,
  type EmailAccount,
} from '../../email/client';
import { fetchEmailFolders, subscribeEmailEvents } from '../../email/client-ext';
import { renderEmailAutomations } from './email-automations';
import { createEmailRail } from './email-rail';
import { renderEmailInbox, type EmailInboxHandle, type InboxScope } from './email-inbox';
import { setAlwaysLoadRemoteImages } from './email-layout';
import { mountEmailRailResizer, syncEmailShellWidthVars } from './email-panel-resize';
import { folderLabel } from './email-layout';
import { ALL_INBOXES, renderUnifiedInbox } from './email-unified';
import {
  mountEmailAssistantPanel,
  type EmailAssistantPanelController,
} from './email-assistant-panel';
import type { EmailAssistantContextSnapshot } from './email-assistant-context';

/** Unsubscribe handles for SSE listeners keyed by panel mount element. */
const panelEventUnsubs = new WeakMap<HTMLElement, () => void>();
/** Assistant controllers keyed by panel mount so remounts release global listeners. */
const panelAssistantControllers = new WeakMap<HTMLElement, EmailAssistantPanelController>();
/** Accounts that already received an automatic backfill kick this session. */
const autoSyncAccounts = new Set<string>();

export interface EmailPanelOptions {
  onStatus?: (state: 'ok' | 'err', message: string) => void;
}

/** IMAP folder for the active rail selection (Views default to INBOX). */
function navFolder(navId: string): string {
  return navId.startsWith('folder:') ? navId.slice('folder:'.length) : 'INBOX';
}

/** Human label for sync progress in the rail. */
function syncProgressLabel(cached: number, folderTotal: number, folder: string): string {
  const name = folderLabel(folder);
  if (folderTotal > 0) {
    return `Syncing ${name} · ${cached}/${folderTotal}`;
  }
  return `Syncing ${name}…`;
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

interface AccountFormOptions extends EmailPanelOptions {
  title?: string;
  /** When true, skip the card heading (used inside tabbed settings). */
  embedded?: boolean;
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
  if (!options.embedded) {
    card.appendChild(
      el(
        'h3',
        'email-setup-title',
        options.title ?? (editing ? 'Edit email account' : 'Connect an email account'),
      ),
    );
  }
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

/** Privacy and reader preferences (global, not per account). */
async function renderEmailPrivacySettings(
  mount: HTMLElement,
  options: EmailPanelOptions,
  embedded = false,
): Promise<void> {
  mount.replaceChildren();
  const card = el('section', 'email-setup-card');
  if (!embedded) {
    card.appendChild(el('h3', 'email-setup-title', 'Privacy'));
  }
  card.appendChild(
    el(
      'p',
      'email-setup-note',
      'Remote images can reveal your IP address and when you read a message. Load them only when you choose, or opt in globally below.',
    ),
  );

  const row = el('label', 'email-field email-field-checkbox');
  const input = el('input') as HTMLInputElement;
  input.type = 'checkbox';
  input.id = 'email-alwaysLoadRemoteImages';
  input.name = 'alwaysLoadRemoteImages';
  input.disabled = true;
  row.appendChild(input);
  row.appendChild(el('span', 'email-field-label', 'Always load remote images'));
  card.appendChild(row);
  mount.appendChild(card);

  try {
    const prefs = await fetchEmailPreferences();
    input.checked = prefs.alwaysLoadRemoteImages;
    setAlwaysLoadRemoteImages(prefs.alwaysLoadRemoteImages);
  } catch (err) {
    options.onStatus?.(
      'err',
      err instanceof Error ? err.message : 'Could not load email preferences',
    );
  } finally {
    input.disabled = false;
  }

  input.addEventListener('change', async () => {
    const next = input.checked;
    input.disabled = true;
    try {
      const prefs = await updateEmailPreferences({ alwaysLoadRemoteImages: next });
      setAlwaysLoadRemoteImages(prefs.alwaysLoadRemoteImages);
      options.onStatus?.(
        'ok',
        prefs.alwaysLoadRemoteImages
          ? 'Remote images will load automatically'
          : 'Remote images blocked until you choose to load them',
      );
    } catch (err) {
      input.checked = !next;
      options.onStatus?.(
        'err',
        err instanceof Error ? err.message : 'Could not save email preferences',
      );
    } finally {
      input.disabled = false;
    }
  });
}

type EmailSettingsTab = 'privacy' | 'account';

interface EmailSettingsOptions extends EmailPanelOptions {
  account: EmailAccount;
  accountCount: number;
  highlightField?: string;
  errorMessage?: string;
  onSaved: () => void;
  onSignedOut: () => void;
  onCancel: () => void;
}

/** Tabbed Email settings — Privacy vs active account connection. */
function renderEmailSettings(
  mount: HTMLElement,
  options: EmailSettingsOptions,
  initialTab: EmailSettingsTab = 'privacy',
): void {
  mount.replaceChildren();

  const shell = el('div', 'email-settings-shell');
  shell.appendChild(el('h2', 'email-settings-title', 'Settings'));

  const tablist = el('div', 'email-settings-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Email settings');

  const privacyPanel = el('div', 'email-settings-panel');
  privacyPanel.id = 'email-settings-panel-privacy';
  privacyPanel.setAttribute('role', 'tabpanel');
  privacyPanel.setAttribute('aria-labelledby', 'email-settings-tab-privacy');

  const accountPanel = el('div', 'email-settings-panel');
  accountPanel.id = 'email-settings-panel-account';
  accountPanel.setAttribute('role', 'tabpanel');
  accountPanel.setAttribute('aria-labelledby', 'email-settings-tab-account');

  const tabs: Record<EmailSettingsTab, HTMLButtonElement> = {
    privacy: el('button', 'email-settings-tab', 'Privacy') as HTMLButtonElement,
    account: el('button', 'email-settings-tab', 'Account') as HTMLButtonElement,
  };

  for (const [id, btn] of Object.entries(tabs) as Array<[EmailSettingsTab, HTMLButtonElement]>) {
    btn.type = 'button';
    btn.id = `email-settings-tab-${id}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', `email-settings-panel-${id}`);
    tablist.appendChild(btn);
  }

  const showTab = (tab: EmailSettingsTab): void => {
    for (const [id, btn] of Object.entries(tabs) as Array<[EmailSettingsTab, HTMLButtonElement]>) {
      const active = id === tab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    }
    privacyPanel.hidden = tab !== 'privacy';
    accountPanel.hidden = tab !== 'account';
  };

  for (const [id, btn] of Object.entries(tabs) as Array<[EmailSettingsTab, HTMLButtonElement]>) {
    btn.addEventListener('click', () => showTab(id));
  }

  shell.append(tablist, privacyPanel, accountPanel);
  mount.appendChild(shell);

  void renderEmailPrivacySettings(privacyPanel, options, true);
  renderAccountForm(accountPanel, {
    ...options,
    embedded: true,
    existing: options.account,
    highlightField: options.highlightField,
    errorMessage: options.errorMessage,
    onSaved: options.onSaved,
    onSignedOut: options.onSignedOut,
    onCancel: options.onCancel,
  });

  showTab(initialTab);
}

/** Main panel entry — one spine rail, one workspace surface (MIN-358). */
export async function renderEmailPanel(
  mount: HTMLElement,
  options: EmailPanelOptions = {},
): Promise<void> {
  panelEventUnsubs.get(mount)?.();
  panelEventUnsubs.delete(mount);
  panelAssistantControllers.get(mount)?.dispose();
  panelAssistantControllers.delete(mount);
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
  let activeAccount = accounts.find((row) => row.isDefault) ?? accounts[0];
  /** True when the stream is showing every mailbox at once. */
  let unified = false;
  /** Which workspace surface is mounted right now. */
  let surfaceMode: 'inbox' | 'automations' | 'setup' = 'inbox';
  /** What the inbox stream is scoped to (driven by the rail's Views/Folders). */
  let scope: InboxScope = { kind: 'triage' };
  /** The rail nav id that reads as active. */
  let activeNav = 'attn';
  /** One-shot intents consumed by the next inbox render. */
  let pendingComposeNew = false;
  let pendingThreadId: string | undefined;
  /** SSE/sync wanted a refresh while the reader was open — run it on close. */
  let pendingInboxRefresh = false;
  let assistantPanel: EmailAssistantPanelController | null = null;

  /** Base metadata published before the inbox supplies a selected thread. */
  const baseAssistantContext = (): EmailAssistantContextSnapshot => ({
    ...(unified ? {} : { accountId: activeAccount.id }),
    accountLabel: unified ? 'All inboxes' : activeAccount.label,
    view:
      surfaceMode === 'automations'
        ? 'Automations'
        : surfaceMode === 'setup'
          ? 'Account settings'
          : activeNav.startsWith('folder:')
            ? folderLabel(activeNav.slice('folder:'.length))
            : activeNav === 'waiting'
              ? 'Waiting on'
              : activeNav === 'unread'
                ? 'Unread'
                : activeNav === 'flagged'
                  ? 'Flagged'
                  : activeNav === 'snoozed'
                    ? 'Snoozed'
                    : 'Needs attention',
    ...(surfaceMode === 'inbox' ? { folder: navFolder(activeNav) } : {}),
  });

  /** Keep the assistant account, review queue, and short context in sync. */
  const syncAssistantScope = (): void => {
    assistantPanel?.setAccount(unified ? null : activeAccount);
    assistantPanel?.setContext(baseAssistantContext());
  };

  /**
   * Status pass-through that also deep-links auth/connection failures to the
   * account form with the offending field highlighted — the difference between
   * a dead-end toast and a one-step fix.
   */
  const handleStatus = (state: 'ok' | 'err', message: string): void => {
    options.onStatus?.(state, message);
    if (state !== 'err' || unified || accountFormMode !== 'none') return;
    const hit = classifyAccountFieldError(message);
    if (hit) openSettings({ highlightField: hit.field, errorMessage: message });
  };

  // ---- Shell: spine rail + workspace ----------------------------------
  const shell = el('div', 'email-shell email-shell-a');
  const workspace = el('div', 'email-workspace');

  // A hairline progress bar above the surface carries sync state, ref-counted
  // so overlapping syncs (manual + background) keep it lit until the last ends.
  const syncBar = el('div', 'email-sync-bar');
  syncBar.setAttribute('role', 'progressbar');
  syncBar.setAttribute('aria-label', 'Syncing mail');
  syncBar.setAttribute('aria-hidden', 'true');
  let syncDepth = 0;
  let manualSyncDepth = 0;
  let lastSyncProgress: { cached: number; folderTotal: number; folder: string; active: boolean } | null =
    null;
  let rail!: ReturnType<typeof createEmailRail>;

  const applyRailSyncProgress = (): void => {
    if (!lastSyncProgress?.active) {
      rail.setSyncProgress({ active: false, label: 'Up to date' });
      return;
    }
    const { cached, folderTotal, folder } = lastSyncProgress;
    const percent = folderTotal > 0 ? Math.round((cached / folderTotal) * 100) : undefined;
    rail.setSyncProgress({
      active: true,
      label: syncProgressLabel(cached, folderTotal, folder),
      percent,
    });
  };

  const setSyncing = (active: boolean): void => {
    syncDepth = Math.max(0, syncDepth + (active ? 1 : -1));
    const on = syncDepth > 0;
    syncBar.classList.toggle('is-active', on);
    syncBar.setAttribute('aria-hidden', on ? 'false' : 'true');
  };

  const surface = el('div', 'email-surface');
  surface.id = 'email-view-panel';
  workspace.append(syncBar, surface);

  rail = createEmailRail({
    accounts,
    activeAccountId: activeAccount.id,
    unified,
    onSelectAccount: (id) => {
      if (id === ALL_INBOXES) {
        unified = true;
      } else {
        const next = accounts.find((row) => row.id === id);
        if (!next) return;
        unified = false;
        activeAccount = next;
      }
      rail.setAccount(unified ? ALL_INBOXES : activeAccount.id, unified, accounts);
      surfaceMode = 'inbox';
      accountFormMode = 'none';
      syncAssistantScope();
      void loadFolders();
      renderSurface();
    },
    onCompose: () => {
      unified = false;
      surfaceMode = 'inbox';
      accountFormMode = 'none';
      pendingComposeNew = true;
      syncAssistantScope();
      renderSurface();
    },
    onSelectNav: (navId) => applyNav(navId),
    onSync: () => {
      if (unified) return;
      void runManualSync(navFolder(activeNav));
    },
    onOpenAutomations: () => {
      surfaceMode = 'automations';
      accountFormMode = 'none';
      activeNav = 'automations';
      rail.setActiveNav('automations');
      syncAssistantScope();
      renderSurface();
    },
    onOpenSettings: () => openSettings(),
  });

  shell.append(rail.root, workspace);
  syncEmailShellWidthVars(shell);
  mountEmailRailResizer(rail.root, shell);
  mount.replaceChildren(shell);
  rail.setActiveNav(activeNav);

  /** Map a rail nav id onto an inbox scope, then render. */
  function applyNav(navId: string): void {
    surfaceMode = 'inbox';
    accountFormMode = 'none';
    activeNav = navId;
    rail.setActiveNav(navId);
    if (navId === 'waiting') {
      scope = { kind: 'waiting' };
    } else if (navId === 'unread' || navId === 'flagged' || navId === 'snoozed') {
      scope = { kind: 'filter', filter: navId };
    } else if (navId.startsWith('folder:')) {
      scope = { kind: 'folder', path: navId.slice('folder:'.length) };
    } else {
      scope = { kind: 'triage' };
    }
    syncAssistantScope();
    renderSurface();
  }

  /** Pull the folder list into the rail; fall back to the cached account list. */
  async function loadFolders(): Promise<void> {
    try {
      const rows = await fetchEmailFolders(activeAccount.id);
      rail.setFolders(rows.map((row) => ({ path: row.path, label: folderLabel(row.path) })));
    } catch {
      rail.setFolders(activeAccount.folders.map((path) => ({ path, label: folderLabel(path) })));
    }
  }

  /** Sync the active account folder until the local store matches the mailbox. */
  async function runManualSync(folder: string): Promise<void> {
    if (manualSyncDepth > 0) return;
    manualSyncDepth += 1;
    lastSyncProgress = { cached: 0, folderTotal: 0, folder, active: true };
    applyRailSyncProgress();
    setSyncing(true);
    try {
      const result = await syncEmailFolder(activeAccount.id, folder);
      const cached = Number(result.cached ?? result.synced ?? 0);
      const folderTotal = Number(result.folderTotal ?? cached);
      lastSyncProgress = {
        cached,
        folderTotal,
        folder,
        active: false,
      };
      applyRailSyncProgress();
      handleStatus(
        'ok',
        result.backfillComplete
          ? `Synced ${result.synced} messages (${cached} cached)`
          : `Synced ${result.synced} messages — backfill continuing in background`,
      );
      if (surfaceMode === 'inbox' && !unified) {
        requestInboxRefresh(true);
      }
    } catch (err) {
      lastSyncProgress = null;
      applyRailSyncProgress();
      handleStatus('err', err instanceof Error ? err.message : 'Sync failed');
    } finally {
      manualSyncDepth = Math.max(0, manualSyncDepth - 1);
      setSyncing(false);
    }
  }

  /** Open the account-settings form in the workspace. */
  function openSettings(deepLink?: { highlightField?: string; errorMessage?: string }): void {
    surfaceMode = 'setup';
    accountFormMode = 'edit';
    activeNav = 'settings';
    rail.setActiveNav('settings');
    syncAssistantScope();
    surface.classList.remove('has-reader');
    assistantPanel?.mountToggle(null);
    const wrap = el('div', 'email-setup-shell email-surface-scroll');
    surface.replaceChildren(wrap);
    renderEmailSettings(
      wrap,
      {
        ...options,
        account: activeAccount,
        accountCount: accounts.length,
        highlightField: deepLink?.highlightField,
        errorMessage: deepLink?.errorMessage,
        onSaved: () => void renderEmailPanel(mount, options),
        onSignedOut: () => void renderEmailPanel(mount, options),
        onCancel: () => applyNav('attn'),
      },
      deepLink?.highlightField ? 'account' : 'privacy',
    );
  }

  /** True when the inbox reader dock is showing a message or compose form. */
  function inboxReaderOpen(): boolean {
    return surface.classList.contains('has-reader');
  }

  /** Live inbox instance — SSE refreshes reuse it instead of remounting. */
  let inboxHandle: EmailInboxHandle | null = null;

  /**
   * Refresh the inbox stream without tearing down an open reader. Background
   * sync and SSE can land while the user is reading; remounting the surface
   * mid-open leaves the dock attached to detached DOM nodes.
   */
  function requestInboxRefresh(allowAnyScope = false): void {
    if (surfaceMode !== 'inbox' || unified) return;
    if (!allowAnyScope && scope.kind !== 'triage') return;
    if (inboxReaderOpen()) {
      pendingInboxRefresh = true;
      return;
    }
    pendingInboxRefresh = false;
    if (inboxHandle) {
      void inboxHandle.refresh();
      return;
    }
    renderSurface();
  }

  /** Flush a refresh that was deferred while the reader was open. */
  function onInboxReaderClosed(): void {
    if (!pendingInboxRefresh) return;
    pendingInboxRefresh = false;
    if (inboxHandle) {
      void inboxHandle.refresh();
      return;
    }
    renderSurface();
  }

  /** Mount whichever surface the current state calls for. */
  function renderSurface(): void {
    if (surfaceMode === 'setup') {
      // openSettings owns this surface; nothing to redraw here.
      return;
    }
    if (surfaceMode === 'automations') {
      surface.classList.remove('has-reader');
      assistantPanel?.mountToggle(null);
      const wrap = el('div', 'email-surface-scroll');
      surface.replaceChildren(wrap);
      void renderEmailAutomations(wrap, {
        account: activeAccount,
        onStatus: handleStatus,
        onClose: () => applyNav('attn'),
      });
      return;
    }

    // Inbox surface. Unified keeps the simple all-mailboxes list for now.
    if (unified) {
      surface.classList.remove('has-reader');
      assistantPanel?.mountToggle(null);
      const streamWrap = el('div', 'email-stream');
      const col = el('div', 'email-stream-col');
      streamWrap.appendChild(col);
      surface.replaceChildren(streamWrap);
      void renderUnifiedInbox(col, {
        accounts,
        onStatus: handleStatus,
        // Opening a message drops into that mailbox's own inbox surface, where
        // reply, archive and the rest actually live.
        onOpen: (message) => {
          const owner = accounts.find((row) => row.id === message.accountId);
          if (!owner) return;
          unified = false;
          activeAccount = owner;
          rail.setAccount(owner.id, false, accounts);
          pendingThreadId = message.threadId;
          void loadFolders();
          applyNav('attn');
        },
      });
      return;
    }

    const openComposeNew = pendingComposeNew;
    pendingComposeNew = false;
    const initialThreadId = pendingThreadId;
    pendingThreadId = undefined;
    inboxHandle = null;
    void renderEmailInbox(surface, {
      account: activeAccount,
      scope,
      onStatus: handleStatus,
      onSyncActivity: setSyncing,
      onCounts: (counts) => rail.setCounts(counts),
      openComposeNew,
      initialThreadId,
      onReaderClosed: onInboxReaderClosed,
      onContextChange: (snapshot) => assistantPanel?.setContext(snapshot),
      onAssistantToggleMount: (slot) => assistantPanel?.mountToggle(slot),
      onReady: (handle) => {
        inboxHandle = handle;
      },
    });
  }

  assistantPanel = mountEmailAssistantPanel(shell, workspace, {
    account: activeAccount,
    context: baseAssistantContext(),
    onStatus: handleStatus,
    onMailRefresh: () => requestInboxRefresh(true),
  });
  panelAssistantControllers.set(mount, assistantPanel);

  panelEventUnsubs.set(
    mount,
    subscribeEmailEvents((type, payload) => {
      if (type === 'sync_progress') {
        if (payload.accountId && payload.accountId !== activeAccount.id) {
          return;
        }
        const folder = String(payload.folder ?? 'INBOX');
        const cached = Number(payload.cached ?? 0);
        const folderTotal = Number(payload.folderTotal ?? 0);
        const complete = payload.backfillComplete === true;
        lastSyncProgress = {
          cached,
          folderTotal,
          folder,
          active: !complete,
        };
        applyRailSyncProgress();
        if (complete && surfaceMode === 'inbox' && !unified) {
          requestInboxRefresh(true);
        }
        return;
      }

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
        if (type === 'pending_actions_updated') {
          void assistantPanel?.refreshReview();
        }
        // Only refresh the live triage stream; skip while the reader is open.
        requestInboxRefresh(false);
      }
    }),
  );

  await loadFolders();
  renderSurface();

  // Resume a partial backfill as soon as the panel opens — older caches only
  // stored the newest page and need no user action to catch up.
  if (!unified && !autoSyncAccounts.has(activeAccount.id)) {
    autoSyncAccounts.add(activeAccount.id);
    void runManualSync(navFolder(activeNav));
  }
}
