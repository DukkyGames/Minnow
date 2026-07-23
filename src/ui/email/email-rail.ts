/**
 * The Email spine rail (MIN-358 Direction A).
 *
 * One navigation spine that absorbs what used to be the top tabs *and* the
 * three-pane folder column: the account switcher, Compose, the agent Views
 * (Needs attention, Waiting on, ...), the IMAP folders, and Automations /
 * Settings at the foot. It owns no data — it renders from a model and reports
 * intent through callbacks, so the panel stays the single source of truth.
 */

import type { EmailAccount } from '../../email/client';
import { EMAIL_ICONS } from './email-icons';
import { ACCOUNT_DOT_CLASSES, ALL_INBOXES, accountColorIndex } from './email-unified';

export interface RailFolder {
  path: string;
  label: string;
}

export interface EmailRailOptions {
  accounts: EmailAccount[];
  /** Active account id, or ALL_INBOXES when unified. */
  activeAccountId: string;
  unified: boolean;
  /** Account id, or ALL_INBOXES for "All inboxes". */
  onSelectAccount(id: string): void;
  onCompose(): void;
  /** A view id ('attn' | 'waiting' | ...) or `folder:<path>`. */
  onSelectNav(navId: string): void;
  onOpenAutomations(): void;
  onOpenSettings(): void;
}

export interface EmailRailHandle {
  root: HTMLElement;
  setFolders(folders: RailFolder[]): void;
  /** Counts keyed by view id or folder path; undefined clears the badge. */
  setCounts(counts: Record<string, number | undefined>): void;
  setActiveNav(navId: string): void;
  setAccount(accountId: string, unified: boolean, accounts: EmailAccount[]): void;
}

interface RailView {
  id: string;
  label: string;
  tone?: 'attn' | 'wait';
}

/** The agent Views, in scan order. "Needs attention" is the default surface. */
const RAIL_VIEWS: RailView[] = [
  { id: 'attn', label: 'Needs attention', tone: 'attn' },
  { id: 'waiting', label: 'Waiting on', tone: 'wait' },
  { id: 'unread', label: 'Unread' },
  { id: 'flagged', label: 'Flagged' },
  { id: 'snoozed', label: 'Snoozed' },
];

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

/** Human provider label for the active mailbox, matching the old chrome hint. */
function providerLabel(account: EmailAccount): string {
  const host = account.imap.host.toLowerCase();
  if (host.includes('gmail') || host.includes('google')) return 'Gmail';
  if (host.includes('outlook') || host.includes('office365')) return 'Outlook';
  if (host.includes('fastmail')) return 'Fastmail';
  return account.imap.host;
}

export function createEmailRail(options: EmailRailOptions): EmailRailHandle {
  let accounts = options.accounts;
  let activeAccountId = options.activeAccountId;
  let unified = options.unified;

  const root = el('aside', 'email-rail');
  root.setAttribute('aria-label', 'Email navigation');

  // ---- Account switcher ------------------------------------------------
  const accountBtn = el('button', 'email-rail-account') as HTMLButtonElement;
  accountBtn.type = 'button';
  accountBtn.setAttribute('aria-haspopup', 'true');
  accountBtn.setAttribute('aria-expanded', 'false');
  const accountDots = el('span', 'email-rail-account-dots');
  const accountText = el('span', 'email-rail-account-text');
  const accountName = el('span', 'email-rail-account-name');
  const accountHint = el('span', 'email-rail-account-hint');
  accountText.append(accountName, accountHint);
  const caret = el('span', 'email-rail-account-caret');
  caret.innerHTML = EMAIL_ICONS.chevronRight;
  accountBtn.append(accountDots, accountText, caret);

  const accountMenu = el('div', 'email-rail-account-menu');
  accountMenu.hidden = true;
  accountMenu.setAttribute('role', 'menu');

  const paintDots = (host: HTMLElement, ids: string[]): void => {
    host.replaceChildren();
    for (const id of ids) {
      const dot = el(
        'span',
        `email-account-dot ${ACCOUNT_DOT_CLASSES[accountColorIndex(accounts, id)]}`,
      );
      dot.title = accounts.find((row) => row.id === id)?.label ?? '';
      host.appendChild(dot);
    }
  };

  const paintAccountFace = (): void => {
    paintDots(accountDots, unified ? accounts.map((row) => row.id) : [activeAccountId]);
    if (unified) {
      accountName.textContent = 'All inboxes';
      accountHint.textContent = `${accounts.length} mailboxes`;
      return;
    }
    const active = accounts.find((row) => row.id === activeAccountId) ?? accounts[0];
    accountName.textContent = active?.label ?? 'Account';
    accountHint.textContent = active
      ? `${providerLabel(active)} · ${active.username}`
      : '';
  };

  const closeMenu = (): void => {
    accountMenu.hidden = true;
    accountBtn.setAttribute('aria-expanded', 'false');
  };

  const buildMenu = (): void => {
    accountMenu.replaceChildren();
    const addOpt = (id: string, label: string, dotIds: string[], active: boolean): void => {
      const opt = el('button', 'email-rail-account-opt') as HTMLButtonElement;
      opt.type = 'button';
      opt.setAttribute('role', 'menuitem');
      if (active) opt.classList.add('is-active');
      const dots = el('span', 'email-rail-account-dots');
      paintDots(dots, dotIds);
      opt.append(dots, el('span', '', label));
      opt.addEventListener('click', () => {
        closeMenu();
        options.onSelectAccount(id);
      });
      accountMenu.appendChild(opt);
    };

    if (accounts.length > 1) {
      addOpt(ALL_INBOXES, 'All inboxes', accounts.map((row) => row.id), unified);
    }
    for (const account of accounts) {
      addOpt(account.id, account.label, [account.id], !unified && account.id === activeAccountId);
    }
  };

  accountBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = accountMenu.hidden;
    if (willOpen) {
      buildMenu();
      accountMenu.hidden = false;
      accountBtn.setAttribute('aria-expanded', 'true');
      const onDocClick = (): void => {
        closeMenu();
        document.removeEventListener('click', onDocClick);
      };
      window.setTimeout(() => document.addEventListener('click', onDocClick), 0);
    } else {
      closeMenu();
    }
  });

  // ---- Compose ---------------------------------------------------------
  const composeBtn = el('button', 'email-rail-compose') as HTMLButtonElement;
  composeBtn.type = 'button';
  composeBtn.innerHTML = `${EMAIL_ICONS.compose}<span>Compose</span>`;
  composeBtn.setAttribute('aria-label', 'Compose new message');
  composeBtn.addEventListener('click', () => options.onCompose());

  // ---- Navigation ------------------------------------------------------
  const nav = el('nav', 'email-rail-nav');

  /** Every nav button, keyed by its nav id, for active + count updates. */
  const navItems = new Map<string, HTMLButtonElement>();

  const mkItem = (
    navId: string,
    label: string,
    opts: { tone?: 'attn' | 'wait'; icon?: string; onActivate?: () => void; track?: boolean } = {},
  ): HTMLButtonElement => {
    const btn = el('button', 'email-rail-item') as HTMLButtonElement;
    btn.type = 'button';
    btn.dataset.nav = navId;
    if (opts.tone) {
      const tick = el('span', `email-rail-item-tick is-${opts.tone}`);
      tick.setAttribute('aria-hidden', 'true');
      btn.appendChild(tick);
    } else if (opts.icon) {
      const icon = el('span', 'email-rail-item-icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = opts.icon;
      btn.appendChild(icon);
    }
    btn.appendChild(el('span', 'email-rail-item-label', label));
    const count = el('span', 'email-rail-item-count');
    btn.appendChild(count);
    btn.addEventListener('click', opts.onActivate ?? (() => options.onSelectNav(navId)));
    // Foot buttons (Automations, Settings) route to their own surfaces and are
    // not part of the inbox nav's active/count tracking.
    if (opts.track !== false) navItems.set(navId, btn);
    return btn;
  };

  const viewsGroup = el('div', 'email-rail-group');
  viewsGroup.appendChild(el('p', 'email-rail-group-label', 'Views'));
  const viewsItems = el('div', 'email-rail-group-items');
  for (const view of RAIL_VIEWS) {
    viewsItems.appendChild(mkItem(view.id, view.label, { tone: view.tone }));
  }
  viewsGroup.appendChild(viewsItems);

  const foldersGroup = el('div', 'email-rail-group');
  foldersGroup.appendChild(el('p', 'email-rail-group-label', 'Folders'));
  const foldersItems = el('div', 'email-rail-group-items');
  foldersGroup.appendChild(foldersItems);

  nav.append(viewsGroup, foldersGroup);

  // ---- Foot ------------------------------------------------------------
  const foot = el('div', 'email-rail-foot');
  const autoBtn = mkItem('automations', 'Automations', {
    icon: EMAIL_ICONS.automations,
    onActivate: () => options.onOpenAutomations(),
    track: false,
  });
  const settingsBtn = mkItem('settings', 'Settings', {
    icon: EMAIL_ICONS.settings,
    onActivate: () => options.onOpenSettings(),
    track: false,
  });
  foot.append(autoBtn, settingsBtn);

  root.append(accountBtn, accountMenu, composeBtn, nav, foot);

  paintAccountFace();

  const setActiveNav = (navId: string): void => {
    for (const [id, btn] of navItems) {
      btn.classList.toggle('is-active', id === navId);
    }
  };

  const setCounts = (counts: Record<string, number | undefined>): void => {
    for (const [id, btn] of navItems) {
      const count = counts[id];
      const cell = btn.querySelector<HTMLElement>('.email-rail-item-count');
      if (!cell) continue;
      cell.textContent = count && count > 0 ? String(count > 999 ? '999+' : count) : '';
    }
  };

  const setFolders = (folders: RailFolder[]): void => {
    foldersItems.replaceChildren();
    // Drop stale folder entries from the nav map before rebuilding.
    for (const key of [...navItems.keys()]) {
      if (key.startsWith('folder:')) navItems.delete(key);
    }
    for (const folder of folders) {
      foldersItems.appendChild(
        mkItem(`folder:${folder.path}`, folder.label, { icon: EMAIL_ICONS.folder }),
      );
    }
  };

  const setAccount = (accountId: string, nextUnified: boolean, nextAccounts: EmailAccount[]): void => {
    accounts = nextAccounts;
    activeAccountId = accountId;
    unified = nextUnified;
    paintAccountFace();
  };

  return { root, setFolders, setCounts, setActiveNav, setAccount };
}
