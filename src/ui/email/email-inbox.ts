/**
 * The unified inbox stream (MIN-358 Direction A).
 *
 * One surface where the agent's read of the inbox (a quiet instrument readout,
 * the narrative digest, and the "Needs attention" queue) is the head of the
 * same column the raw conversation stream flows into. The old Dashboard and
 * Mail tabs collapse into this. The reader docks in from the right rather than
 * occupying a permanent third pane.
 *
 * It reuses the mail client's proven pieces: `renderHighlightRow` for the
 * triage queue, `renderBodyWithRemoteControls` for message bodies, and
 * `mountEmailCompose` for replies — so this is a re-composition of the IA, not
 * a re-implementation of mail behaviour.
 */

import type {
  EmailAccount,
  EmailFollowup,
  EmailInboxSummary,
  EmailMessage,
  EmailThreadSummary,
} from '../../email/client';
import {
  downloadEmailAttachment,
  fetchEmailThread,
  fetchEmailThreads,
  saveBlobAs,
  syncEmailFolder,
} from '../../email/client';
import {
  archiveEmailMessage,
  deleteEmailMessage,
  fetchInboxSummary,
  moveEmailMessage,
  requestThreadSummary,
  setEmailMessageFlags,
} from '../../email/client-ext';
import { mountEmailCompose, type ComposeMode } from './email-compose';
import { renderHighlightRow, type EmailDashboardOptions } from './email-dashboard';
import {
  folderLabel,
  formatBytes,
  formatWhen,
  parseSender,
  previewKind,
  renderBodyWithRemoteControls,
  senderInitials,
} from './email-layout';
import { toConversationRow } from './email-conversation-row';
import { EMAIL_ICONS } from './email-icons';
import { showActionUndoToast } from './email-undo-toast';

/** What the stream is scoped to, driven by the rail's Views and Folders. */
export type InboxScope =
  | { kind: 'triage' }
  | { kind: 'waiting' }
  | { kind: 'filter'; filter: 'unread' | 'flagged' | 'snoozed' }
  | { kind: 'folder'; path: string };

export interface EmailInboxOptions {
  account: EmailAccount;
  scope: InboxScope;
  onStatus?: (state: 'ok' | 'err', message: string) => void;
  /** Toggle the chrome sync bar (ref-counted by the panel). */
  onSyncActivity?: (active: boolean) => void;
  /** Report inbox counts so the rail can badge its Views and Folders. */
  onCounts?: (counts: Record<string, number | undefined>) => void;
  /** Open a fresh "new message" compose in the dock on first render. */
  openComposeNew?: boolean;
  /** Open straight into a thread (e.g. from a digest deep-link). */
  initialThreadId?: string;
}

const PAGE = 40;

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

function iconBtn(svg: string, label: string, className = 'email-icon-btn'): HTMLButtonElement {
  const btn = el('button', className) as HTMLButtonElement;
  btn.type = 'button';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = svg;
  return btn;
}

/** IMAP folder the scope reads from; INBOX for the agent Views. */
function scopeFolder(scope: InboxScope): string {
  return scope.kind === 'folder' ? scope.path : 'INBOX';
}

/** Server-side filter for the scope, if any. */
function scopeFilter(scope: InboxScope): 'unread' | 'flagged' | 'snoozed' | undefined {
  return scope.kind === 'filter' ? scope.filter : undefined;
}

/** Only the default triage view leads with the agent's read of the inbox. */
function scopeShowsHead(scope: InboxScope): boolean {
  return scope.kind === 'triage';
}

/** Human title for the current scope, shown as the "everything else" marker. */
function scopeMarker(scope: InboxScope): string {
  switch (scope.kind) {
    case 'triage':
      return 'Everything else';
    case 'waiting':
      return 'Waiting on';
    case 'filter':
      return scope.filter === 'unread' ? 'Unread' : scope.filter === 'flagged' ? 'Flagged' : 'Snoozed';
    case 'folder':
      return folderLabel(scope.path);
  }
}

export async function renderEmailInbox(mount: HTMLElement, options: EmailInboxOptions): Promise<void> {
  const surface = mount;
  const { account, scope } = options;

  surface.classList.remove('has-reader');
  surface.replaceChildren();

  const stream = el('div', 'email-stream');
  const streamCol = el('div', 'email-stream-col');
  stream.appendChild(streamCol);

  const scrim = el('div', 'email-reader-scrim');
  const dock = el('div', 'email-reader-dock');
  dock.setAttribute('role', 'dialog');
  dock.setAttribute('aria-modal', 'false');
  dock.setAttribute('aria-label', 'Message');

  surface.append(stream, scrim, dock);
  scrim.addEventListener('click', () => closeReader());

  // ---- State -----------------------------------------------------------
  let offset = 0;
  let search = '';
  let threads: EmailThreadSummary[] = [];
  let total = 0;
  let summary: EmailInboxSummary | null = null;
  let followups: EmailFollowup[] = [];
  let selectedThreadId: string | null = null;
  let composeMode: ComposeMode | null = null;

  const dashOptions: EmailDashboardOptions = {
    account,
    onStatus: options.onStatus,
    onSyncActivity: options.onSyncActivity,
    onOpenThread: (threadId) => void openThread(threadId),
    onOpenMail: () => {
      // Already on the inbox surface; nothing to route to.
    },
    onRefresh: () => void reload({ showLoading: false }),
  };

  // ---- Data ------------------------------------------------------------
  const reportCounts = (payload: {
    summary: EmailInboxSummary;
    unreadByFolder: Record<string, number>;
    followups: EmailFollowup[];
  }): void => {
    const counts: Record<string, number | undefined> = {
      attn: payload.summary.highlights.length,
      waiting: payload.followups.length,
      unread: payload.summary.unread,
    };
    for (const [path, n] of Object.entries(payload.unreadByFolder ?? {})) {
      counts[`folder:${path}`] = n;
    }
    options.onCounts?.(counts);
  };

  const loadData = async (): Promise<void> => {
    // The summary feeds both the triage head and the rail counts; it is cached
    // server-side, so fetching it for every scope is cheap.
    try {
      const payload = await fetchInboxSummary(account.id);
      summary = payload.summary;
      followups = payload.followups ?? [];
      reportCounts(payload);

      // Cold cache: sync once so triage and the stream have something to show.
      if (scope.kind === 'triage' && payload.summary.text.includes('Sync to fetch new mail')) {
        options.onSyncActivity?.(true);
        try {
          await syncEmailFolder(account.id, 'INBOX');
          const fresh = await fetchInboxSummary(account.id);
          summary = fresh.summary;
          followups = fresh.followups ?? [];
          reportCounts(fresh);
        } catch (err) {
          options.onStatus?.('err', err instanceof Error ? err.message : 'Inbox sync failed');
        } finally {
          options.onSyncActivity?.(false);
        }
      }
    } catch {
      summary = null;
    }

    // "Waiting on" is followup-only; it has no conversation stream of its own.
    if (scope.kind === 'waiting') {
      threads = [];
      total = 0;
      return;
    }

    const result = await fetchEmailThreads(account.id, {
      folder: scopeFolder(scope),
      offset,
      limit: PAGE,
      filter: scopeFilter(scope),
      query: search || undefined,
    });
    threads = result.threads;
    total = result.total;
  };

  // ---- Stream rendering ------------------------------------------------
  const renderReadout = (): HTMLElement | null => {
    if (!summary) return null;
    const readout = el('div', 'email-readout');
    readout.setAttribute('role', 'group');
    readout.setAttribute('aria-label', 'Inbox status');

    const metric = (cls: string, value: number, label: string): void => {
      const cell = el('span', `email-readout-metric ${cls}`);
      cell.append(el('b', '', String(value)), document.createTextNode(label));
      readout.appendChild(cell);
    };
    metric('is-attn', summary.highlights.length, ' need you');
    metric('is-wait', followups.length, ' waiting');
    metric('is-unread', summary.unread, ' unread');

    const synced = el('span', 'email-readout-synced', relativeTime(summary.generatedAt));
    readout.appendChild(synced);
    return readout;
  };

  const renderStreamRow = (thread: EmailThreadSummary): HTMLElement => {
    const model = toConversationRow(thread);
    const row = el('button', 'email-stream-row') as HTMLButtonElement;
    row.type = 'button';
    row.classList.toggle('is-unread', model.unread);
    row.classList.toggle('is-selected', thread.threadId === selectedThreadId);

    row.appendChild(
      el('span', 'email-list-avatar', senderInitials(thread.participants?.[0] ?? '')),
    );

    const main = el('div', 'email-stream-row-main');
    const from = el('span', 'email-stream-row-from');
    from.textContent = model.participants + (model.countLabel ? `  ${model.countLabel}` : '');
    main.appendChild(from);
    const subject = el('span', 'email-stream-row-subject');
    subject.textContent = model.subject;
    if (model.snippet) {
      const snip = el('span', 'email-stream-row-snippet', `  ${model.snippet}`);
      subject.appendChild(snip);
    }
    main.appendChild(subject);
    row.appendChild(main);

    const meta = el('div', 'email-stream-row-meta');
    if (model.unread) meta.appendChild(el('span', 'email-stream-row-dot'));
    if (model.hasAttachments) {
      const attach = el('span', 'email-stream-row-attach');
      attach.innerHTML = EMAIL_ICONS.attach;
      attach.title = 'Has attachments';
      meta.appendChild(attach);
    }
    meta.appendChild(el('span', 'email-stream-row-date', formatWhen(model.date)));
    row.appendChild(meta);

    row.addEventListener('click', () => void openThread(thread.threadId));
    return row;
  };

  const renderStream = (): void => {
    streamCol.replaceChildren();

    // --- Triage head (default view only) ---
    if (scopeShowsHead(scope) && summary) {
      const readout = renderReadout();
      if (readout) streamCol.appendChild(readout);

      const brief = (summary.text ?? '').trim();
      if (brief) {
        streamCol.appendChild(el('p', 'email-stream-brief', brief));
      }

      if (summary.highlights.length > 0) {
        const marker = el('div', 'email-stream-marker', 'Needs attention');
        streamCol.appendChild(marker);
        const attn = el('div', 'email-dash-rows');
        for (const highlight of summary.highlights.slice(0, 5)) {
          renderHighlightRow(attn, highlight, account, dashOptions);
        }
        streamCol.appendChild(attn);
      }
    }

    // --- Waiting on (followups) ---
    if (scope.kind === 'waiting') {
      streamCol.appendChild(buildScopeMarker());
      streamCol.appendChild(renderFollowups());
      return;
    }

    // --- The conversation stream ---
    streamCol.appendChild(buildScopeMarker());

    const rows = el('div', 'email-stream-rows');
    if (threads.length === 0) {
      const empty = el('div', 'email-stream-empty');
      empty.appendChild(el('p', 'email-empty-title', emptyTitle()));
      empty.appendChild(el('p', 'email-empty-copy', emptyCopy()));
      rows.appendChild(empty);
    } else {
      for (const thread of threads) rows.appendChild(renderStreamRow(thread));
    }
    streamCol.appendChild(rows);

    if (total > offset + PAGE || offset > 0) {
      const pager = el('div', 'email-stream-more');
      if (offset > 0) {
        const prev = el('button', 'email-btn', 'Newer') as HTMLButtonElement;
        prev.type = 'button';
        prev.addEventListener('click', () => {
          offset = Math.max(0, offset - PAGE);
          void reload({ showLoading: true });
        });
        pager.appendChild(prev);
      }
      if (total > offset + PAGE) {
        const next = el('button', 'email-btn', 'Older') as HTMLButtonElement;
        next.type = 'button';
        next.addEventListener('click', () => {
          offset += PAGE;
          void reload({ showLoading: true });
        });
        pager.appendChild(next);
      }
      streamCol.appendChild(pager);
    }
  };

  const buildScopeMarker = (): HTMLElement => {
    const marker = el('div', 'email-stream-marker', scopeMarker(scope));
    // A slim inline search sits with the "everything else" marker.
    const tools = el('div', 'email-stream-tools');
    const searchWrap = el('label', 'email-stream-search');
    searchWrap.innerHTML = EMAIL_ICONS.search;
    const input = el('input') as HTMLInputElement;
    input.type = 'search';
    input.value = search;
    input.placeholder = 'Search';
    input.setAttribute('aria-label', 'Search mail');
    let timer: number | undefined;
    input.addEventListener('input', () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        search = input.value.trim();
        offset = 0;
        void reload({ showLoading: true, keepFocus: 'search' });
      }, 300);
    });
    searchWrap.appendChild(input);
    tools.appendChild(searchWrap);
    marker.appendChild(tools);
    return marker;
  };

  const renderFollowups = (): HTMLElement => {
    const wrap = el('div', 'email-dash-rows');
    if (followups.length === 0) {
      const empty = el('div', 'email-stream-empty');
      empty.appendChild(el('p', 'email-empty-title', 'Nothing outstanding'));
      empty.appendChild(
        el('p', 'email-empty-copy', 'Sent mail that expects a reply will show up here.'),
      );
      wrap.appendChild(empty);
      return wrap;
    }
    for (const followup of followups) {
      const row = el('article', 'email-dash-row');
      const main = el('div', 'email-dash-row-main');
      const title = el('div', 'email-dash-row-title');
      title.appendChild(el('span', 'email-dash-row-subject', followup.subject || '(no subject)'));
      main.appendChild(title);
      const meta = el('div', 'email-dash-row-meta');
      meta.appendChild(el('span', 'email-dash-row-from', `to ${followup.to}`));
      const overdue = new Date(followup.expectedBy).getTime() < Date.now();
      const when = el(
        'span',
        `email-urgency-badge ${overdue ? 'email-urgency-high' : 'email-urgency-normal'}`,
        overdue ? 'overdue' : `by ${new Date(followup.expectedBy).toLocaleDateString()}`,
      );
      meta.appendChild(when);
      main.appendChild(meta);
      row.appendChild(main);
      if (followup.threadId) {
        const open = el('button', 'email-btn', 'Open') as HTMLButtonElement;
        open.type = 'button';
        open.addEventListener('click', () => void openThread(followup.threadId));
        row.appendChild(open);
      }
      wrap.appendChild(row);
    }
    return wrap;
  };

  const emptyTitle = (): string => {
    if (search) return 'No matches';
    if (scope.kind === 'filter' && scope.filter === 'unread') return "You're all caught up";
    return 'Nothing here';
  };
  const emptyCopy = (): string => {
    if (search) return 'No conversations match that search. Try fewer words.';
    if (scope.kind === 'filter') return 'Nothing matches this view right now.';
    return 'Sync this mailbox or pick another view.';
  };

  // ---- Reader dock -----------------------------------------------------
  const closeReader = (): void => {
    selectedThreadId = null;
    composeMode = null;
    surface.classList.remove('has-reader');
    // Reflect the cleared selection in the stream rows.
    for (const row of streamCol.querySelectorAll('.email-stream-row.is-selected')) {
      row.classList.remove('is-selected');
    }
  };

  const openCompose = (mode: ComposeMode, thread: EmailMessage[], selected: EmailMessage): void => {
    composeMode = mode;
    const mountEl = dock.querySelector<HTMLElement>('.email-reader-compose-mount');
    if (!mountEl) return;
    mountEmailCompose(mountEl, {
      account,
      mode,
      threadId: selected.threadId,
      messages: thread,
      selectedMessage: selected,
      onStatus: options.onStatus,
      onRefresh: () => void reload({ showLoading: false }),
      onSent: () => {
        composeMode = null;
        closeReader();
        void reload({ showLoading: false });
      },
    });
    mountEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const removeOpen = async (
    message: EmailMessage,
    action: 'archive' | 'delete',
    label: string,
  ): Promise<void> => {
    const subject = message.subject || 'message';
    const origin = message.folder;
    closeReader();
    const undo = async (): Promise<void> => {
      await moveEmailMessage(account.id, message.id, origin);
      await reload({ showLoading: false });
    };
    try {
      await (action === 'archive'
        ? archiveEmailMessage(account.id, message.id)
        : deleteEmailMessage(account.id, message.id));
      showActionUndoToast(`${label} "${subject}"`, { onUndo: undo, onStatus: options.onStatus });
      await reload({ showLoading: false });
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : `Couldn't ${action}`);
    }
  };

  const openThread = async (threadId: string): Promise<void> => {
    selectedThreadId = threadId;
    composeMode = null;
    // Reflect selection in the stream immediately.
    for (const row of streamCol.querySelectorAll('.email-stream-row')) {
      row.classList.remove('is-selected');
    }

    let thread: EmailMessage[];
    try {
      ({ messages: thread } = await fetchEmailThread(account.id, threadId));
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'Could not open the conversation');
      return;
    }
    const selected = thread[thread.length - 1];
    if (!selected) return;

    if (!selected.flags?.seen) {
      void setEmailMessageFlags(account.id, selected.id, { seen: true }).then(
        () => reportCountsAfterSeen(),
        () => undefined,
      );
    }

    dock.replaceChildren();
    const close = iconBtn(EMAIL_ICONS.back, 'Close', 'email-icon-btn email-reader-dock-close');
    close.addEventListener('click', () => closeReader());
    dock.appendChild(close);

    const scrollArea = el('div', 'email-reader-dock-scroll');
    dock.appendChild(scrollArea);

    // --- Header ---
    const header = el('header', 'email-reader-head');
    header.appendChild(el('h2', 'email-reader-subject', selected.subject || '(no subject)'));
    const sender = parseSender(selected.from);
    const metaRow = el('div', 'email-reader-meta-row');
    metaRow.appendChild(el('span', 'email-sender-avatar', senderInitials(selected.from)));
    const metaText = el('div', 'email-reader-meta-text');
    metaText.appendChild(el('p', 'email-reader-from', sender.name));
    if (sender.email) metaText.appendChild(el('p', 'email-reader-email', sender.email));
    metaText.appendChild(el('p', 'email-reader-date', formatWhen(selected.date)));
    metaRow.appendChild(metaText);
    header.appendChild(metaRow);

    const primary = el('div', 'email-reader-primary-actions');
    const mkPrimary = (icon: string, label: string, mode: ComposeMode, isPrimary = false): void => {
      const btn = iconBtn(
        icon,
        label,
        `email-btn ${isPrimary ? 'email-btn-primary ' : ''}email-btn-icon`,
      );
      btn.appendChild(el('span', 'email-btn-label', label));
      btn.addEventListener('click', () => openCompose(mode, thread, selected));
      primary.appendChild(btn);
    };
    mkPrimary(EMAIL_ICONS.reply, 'Reply', 'reply', true);
    mkPrimary(EMAIL_ICONS.replyAll, 'Reply all', 'replyAll');
    mkPrimary(EMAIL_ICONS.forward, 'Forward', 'forward');
    header.appendChild(primary);

    const secondary = el('div', 'email-reader-actions');
    const flagBtn = iconBtn(
      selected.flags?.flagged ? EMAIL_ICONS.starFilled : EMAIL_ICONS.star,
      selected.flags?.flagged ? 'Remove flag' : 'Flag',
    );
    flagBtn.classList.toggle('is-active', Boolean(selected.flags?.flagged));
    flagBtn.addEventListener('click', async () => {
      const next = !selected.flags?.flagged;
      try {
        await setEmailMessageFlags(account.id, selected.id, { flagged: next });
        flagBtn.classList.toggle('is-active', next);
        flagBtn.innerHTML = next ? EMAIL_ICONS.starFilled : EMAIL_ICONS.star;
      } catch (err) {
        options.onStatus?.('err', err instanceof Error ? err.message : 'Flag failed');
      }
    });
    const archiveBtn = iconBtn(EMAIL_ICONS.archive, 'Archive');
    archiveBtn.addEventListener('click', () => void removeOpen(selected, 'archive', 'Archived'));
    const deleteBtn = iconBtn(EMAIL_ICONS.trash, 'Delete');
    deleteBtn.classList.add('email-icon-btn--danger');
    deleteBtn.addEventListener('click', () => void removeOpen(selected, 'delete', 'Trashed'));
    secondary.append(flagBtn, archiveBtn, deleteBtn);
    header.appendChild(secondary);
    scrollArea.appendChild(header);

    // --- Catch-up on long threads ---
    if (thread.length > 3 || thread.some((m) => (m.bodyText?.length ?? 0) > 8000)) {
      const catchup = el('details', 'email-reader-catchup');
      catchup.open = true;
      const label = el('summary', 'email-reader-catchup-label', 'Catch up');
      catchup.appendChild(label);
      const busy = el('p', 'email-reader-catchup-text', 'Summarizing…');
      catchup.appendChild(busy);
      scrollArea.appendChild(catchup);
      void requestThreadSummary(account.id, threadId)
        .then(({ eligible, summary: s }) => {
          if (eligible && s?.text) {
            catchup.replaceChildren(label, el('p', 'email-reader-catchup-text', s.text));
          } else {
            catchup.remove();
          }
        })
        .catch(() => catchup.remove());
    }

    // --- Bodies ---
    const bodyStack = el('div', 'email-reader-body-stack');
    for (const msg of thread) {
      const block = el('article', 'email-reader-msg');
      block.appendChild(
        el('p', 'email-reader-msg-meta', `${msg.from} · ${formatWhen(msg.date)}`),
      );
      const downloadable = (msg.attachments ?? []).filter((att) => !att.inline);
      if (downloadable.length > 0) {
        const attRow = el('div', 'email-reader-attachments');
        attRow.appendChild(el('span', 'email-reader-att-label', 'Attachments'));
        for (const att of downloadable) {
          const chip = el(
            'button',
            'email-reader-att-chip',
            `${att.filename} (${formatBytes(att.size)})`,
          ) as HTMLButtonElement;
          chip.type = 'button';
          chip.title = previewKind(att.contentType, att.filename)
            ? `Open ${att.filename}`
            : `Download ${att.filename}`;
          chip.addEventListener('click', async () => {
            chip.disabled = true;
            try {
              const { blob, filename } = await downloadEmailAttachment(account.id, msg.id, att.index);
              saveBlobAs(blob, filename);
            } catch (err) {
              options.onStatus?.('err', err instanceof Error ? err.message : 'Download failed');
            } finally {
              chip.disabled = false;
            }
          });
          attRow.appendChild(chip);
        }
        block.appendChild(attRow);
      }
      block.appendChild(renderBodyWithRemoteControls(msg, 'html', account.id, options.onStatus));
      bodyStack.appendChild(block);
    }
    scrollArea.appendChild(bodyStack);

    // --- Compose mount + collapsed affordance ---
    const composeMount = el('div', 'email-reader-compose-mount');
    scrollArea.appendChild(composeMount);
    const collapsed = el(
      'button',
      'email-compose-collapsed',
      'Reply to this conversation…',
    ) as HTMLButtonElement;
    collapsed.type = 'button';
    collapsed.addEventListener('click', () => openCompose('reply', thread, selected));
    composeMount.appendChild(collapsed);

    surface.classList.add('has-reader');
  };

  /** After marking a message seen, nudge the rail's unread badge down. */
  const reportCountsAfterSeen = async (): Promise<void> => {
    try {
      const payload = await fetchInboxSummary(account.id);
      summary = payload.summary;
      followups = payload.followups ?? [];
      reportCounts(payload);
    } catch {
      // A failed refresh just leaves the badge as it was.
    }
  };

  // ---- Reload ----------------------------------------------------------
  const reload = async (opts?: { showLoading?: boolean; keepFocus?: 'search' }): Promise<void> => {
    if (opts?.showLoading) {
      streamCol.replaceChildren(el('p', 'email-stream-loading', 'Loading…'));
    }
    try {
      await loadData();
      renderStream();
      if (opts?.keepFocus === 'search') {
        streamCol.querySelector<HTMLInputElement>('.email-stream-search input')?.focus();
      }
    } catch (err) {
      streamCol.replaceChildren(
        el('p', 'email-stream-loading', err instanceof Error ? err.message : 'Load failed'),
      );
    }
  };

  // ---- Boot ------------------------------------------------------------
  streamCol.replaceChildren(el('p', 'email-stream-loading', 'Loading inbox…'));
  await reload({ showLoading: false });

  if (options.openComposeNew) {
    dock.replaceChildren();
    const close = iconBtn(EMAIL_ICONS.back, 'Close', 'email-icon-btn email-reader-dock-close');
    close.addEventListener('click', () => closeReader());
    const scrollArea = el('div', 'email-reader-dock-scroll');
    const header = el('header', 'email-reader-head');
    header.appendChild(el('h2', 'email-reader-subject', 'New message'));
    scrollArea.appendChild(header);
    const composeMount = el('div', 'email-reader-compose-mount');
    scrollArea.appendChild(composeMount);
    dock.append(close, scrollArea);
    mountEmailCompose(composeMount, {
      account,
      mode: 'new',
      onStatus: options.onStatus,
      onSent: () => {
        closeReader();
        void reload({ showLoading: false });
      },
    });
    surface.classList.add('has-reader');
  } else if (options.initialThreadId) {
    void openThread(options.initialThreadId);
  }
}

/** Short relative label like "2m ago" for the readout's freshness. */
function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'just now';
  const delta = Date.now() - date.getTime();
  if (delta < 60_000) return 'just now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
