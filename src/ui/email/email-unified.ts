import type { EmailAccount, EmailMessage } from '../../email/client';
import { fetchEmailMessagesExtended } from '../../email/client-ext';

/** A message plus the mailbox it belongs to. */
export interface UnifiedMessage extends EmailMessage {
  accountId: string;
  accountLabel: string;
  /** Index into ACCOUNT_DOT_CLASSES, so the dot is stable per account. */
  accountColorIndex: number;
}

export interface UnifiedInboxResult {
  messages: UnifiedMessage[];
  /** Accounts that could not be read, with why. */
  failures: Array<{ accountId: string; label: string; error: string }>;
}

/** Accent tints for the per-account dot. */
export const ACCOUNT_DOT_CLASSES = [
  'email-account-dot--1',
  'email-account-dot--2',
  'email-account-dot--3',
  'email-account-dot--4',
] as const;

/** Stable colour slot for an account, by its position in the account list. */
export function accountColorIndex(accounts: EmailAccount[], accountId: string): number {
  const at = accounts.findIndex((account) => account.id === accountId);
  return at < 0 ? 0 : at % ACCOUNT_DOT_CLASSES.length;
}

// ── Merge ────────────────────────────────────────────────────────────────────

export function mergeByDate(pages: UnifiedMessage[][], limit: number): UnifiedMessage[] {
  return pages
    .flat()
    .sort((a, b) => {
      const left = new Date(String(b.date ?? '')).getTime() || 0;
      const right = new Date(String(a.date ?? '')).getTime() || 0;
      return left - right;
    })
    .slice(0, Math.max(1, limit));
}

export async function loadUnifiedInbox(
  accounts: EmailAccount[],
  query: { folder?: string; limit?: number; filter?: string; search?: string } = {},
): Promise<UnifiedInboxResult> {
  const limit = Math.min(200, Math.max(1, query.limit ?? 50));
  const failures: UnifiedInboxResult['failures'] = [];

  const pages = await Promise.all(
    accounts.map(async (account): Promise<UnifiedMessage[]> => {
      try {
        const result = await fetchEmailMessagesExtended(account.id, {
          folder: query.folder ?? account.folders?.[0] ?? 'INBOX',
          offset: 0,
          limit,
          filter: query.filter as never,
          search: query.search,
        });

        const colorIndex = accountColorIndex(accounts, account.id);
        return result.messages.map((message) => ({
          ...message,
          accountId: account.id,
          accountLabel: account.label,
          accountColorIndex: colorIndex,
        }));
      } catch (err) {
        failures.push({
          accountId: account.id,
          label: account.label,
          error: err instanceof Error ? err.message : 'Could not load this account',
        });
        return [];
      }
    }),
  );

  return { messages: mergeByDate(pages, limit), failures };
}

/** Sentinel value for the "All inboxes" option in the account select. */
export const ALL_INBOXES = '__all__';

// ── DOM helpers ──────────────────────────────────────────────────────────────

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

/** Sender display name, falling back to the address. */
function senderName(header: string): string {
  const raw = String(header ?? '').trim();
  const angled = /^(.*?)<([^>]+)>\s*$/.exec(raw);
  const name = angled ? angled[1].trim().replace(/^["']|["']$/g, '') : '';
  return name || (angled ? angled[2] : raw);
}

function formatWhen(iso: string): string {
  const when = new Date(String(iso ?? ''));
  if (!Number.isFinite(when.getTime())) return '';
  const sameDay = when.toDateString() === new Date().toDateString();
  return sameDay
    ? when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : when.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Unified inbox ────────────────────────────────────────────────────────────

/** Render the merged inbox. */
export async function renderUnifiedInbox(
  mount: HTMLElement,
  options: {
    accounts: EmailAccount[];
    onOpen: (message: UnifiedMessage) => void;
    onStatus?: (state: 'ok' | 'err', message: string) => void;
  },
): Promise<void> {
  mount.replaceChildren(el('p', 'email-loading', 'Loading all inboxes…'));

  let result: UnifiedInboxResult;
  try {
    result = await loadUnifiedInbox(options.accounts, { limit: 50 });
  } catch (err) {
    mount.replaceChildren(
      el(
        'p',
        'email-empty is-err',
        err instanceof Error ? err.message : 'Could not load the unified inbox',
      ),
    );
    return;
  }

  const pane = el('section', 'email-list-pane email-unified-pane');

  const header = el('div', 'email-list-toolbar');
  header.appendChild(
    el(
      'span',
      'email-list-page',
      `${result.messages.length} newest across ${options.accounts.length} mailboxes`,
    ),
  );
  pane.appendChild(header);

  const legend = el('div', 'email-unified-legend');
  legend.setAttribute('role', 'list');
  legend.setAttribute('aria-label', 'Mailbox colours');
  for (const account of options.accounts) {
    const idx = accountColorIndex(options.accounts, account.id);
    const item = el('span', 'email-unified-legend-item');
    item.setAttribute('role', 'listitem');
    const dot = el('span', `email-account-dot ${ACCOUNT_DOT_CLASSES[idx]}`);
    dot.setAttribute('aria-hidden', 'true');
    item.appendChild(dot);
    item.appendChild(el('span', 'email-unified-legend-label', account.label));
    legend.appendChild(item);
  }
  pane.appendChild(legend);

  for (const failure of result.failures) {
    const warning = el(
      'p',
      'email-empty is-err',
      `${failure.label}: ${failure.error}`,
    );
    pane.appendChild(warning);
  }

  const list = el('div', 'email-list-rows');

  if (result.messages.length === 0 && result.failures.length === 0) {
    const empty = el('div', 'email-list-empty');
    empty.appendChild(el('p', 'email-empty-title', 'Nothing waiting'));
    empty.appendChild(
      el('p', 'email-empty-copy', 'Every inbox is clear.'),
    );
    list.appendChild(empty);
  }

  for (const message of result.messages) {
    const row = el('div', 'email-list-row');
    row.classList.toggle('is-unread', !message.flags?.seen);

    const dot = el('span', `email-account-dot ${ACCOUNT_DOT_CLASSES[message.accountColorIndex]}`);
    dot.title = message.accountLabel;
    dot.setAttribute('aria-label', message.accountLabel);
    row.appendChild(dot);

    const main = el('button', 'email-list-row-main') as HTMLButtonElement;
    main.type = 'button';
    main.appendChild(el('span', 'email-list-from', senderName(message.from)));
    main.appendChild(
      el('span', 'email-list-subject', message.subject || '(no subject)'),
    );
    if (message.bodyPreview) {
      main.appendChild(el('span', 'email-list-snippet', message.bodyPreview));
    }
    main.addEventListener('click', () => options.onOpen(message));
    row.appendChild(main);

    const meta = el('div', 'email-list-row-meta');
    if (!message.flags?.seen) {
      meta.appendChild(el('span', 'email-list-unread-dot', ''));
    }
    meta.appendChild(el('span', 'email-list-date', formatWhen(message.date)));
    row.appendChild(meta);

    list.appendChild(row);
  }

  pane.appendChild(list);
  mount.replaceChildren(pane);
}
