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
  EmailNarrativeDigest,
  EmailPendingAction,
  EmailThreadSummary,
} from '../../email/client';
import {
  downloadEmailAttachment,
  fetchEmailThread,
  fetchEmailThreads,
  hydrateThreadBodies,
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
import {
  renderDigestActionGroups,
  renderHighlightRow,
  renderPendingActions,
  type EmailDashboardOptions,
} from './email-dashboard';
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
import {
  mountEmailReaderDockResizer,
  syncEmailReaderDockResizer,
} from './email-panel-resize';
import type { EmailAssistantContextSnapshot } from './email-assistant-context';

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
  /** Fired when the reader dock closes so the panel can flush a deferred refresh. */
  onReaderClosed?: () => void;
  /** Publish identifiers and short labels for the Email assistant prompt. */
  onContextChange?: (snapshot: EmailAssistantContextSnapshot) => void;
}

/** Bumped on every full inbox remount; stale openThread calls bail after this changes. */
let emailInboxSession = 0;

/** Conversations shown per page. */
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

/** Current rail view label for assistant context, distinct from stream markers. */
function scopeContextLabel(scope: InboxScope): string {
  if (scope.kind === 'triage') return 'Needs attention';
  return scopeMarker(scope);
}

export async function renderEmailInbox(mount: HTMLElement, options: EmailInboxOptions): Promise<void> {
  const session = ++emailInboxSession;
  const surface = mount;
  const { account, scope } = options;

  surface.classList.remove('has-reader');
  surface.replaceChildren();

  const stream = el('div', 'email-stream');
  const streamCol = el('div', 'email-stream-col');
  stream.appendChild(streamCol);

  const scrim = el('div', 'email-reader-scrim');
  const dock = el('div', 'email-reader-dock');
  const dockBody = el('div', 'email-reader-dock-body');
  dock.appendChild(dockBody);
  dock.setAttribute('role', 'dialog');
  dock.setAttribute('aria-modal', 'false');
  dock.setAttribute('aria-label', 'Message');

  surface.append(stream, scrim, dock);
  mountEmailReaderDockResizer(surface);
  scrim.addEventListener('click', () => closeReader());

  // ---- State -----------------------------------------------------------
  let search = '';
  /** Conversations for the page currently on screen. */
  let threads: EmailThreadSummary[] = [];
  let total = 0;
  /** Zero-based index of the page on screen. */
  let page = 0;
  /** Bumped on every fetch so a slow page load can't clobber a newer one. */
  let listGeneration = 0;
  let summary: EmailInboxSummary | null = null;
  let digest: EmailNarrativeDigest | null = null;
  let pendingActions: EmailPendingAction[] = [];
  let followups: EmailFollowup[] = [];
  let selectedThreadId: string | null = null;
  let selectedThreadSubject = '';
  let selectedMessageId = '';
  let composeMode: ComposeMode | null = null;
  /** Assigned after `reload` is defined; the readout refresh button calls this. */
  let syncAndReload: () => Promise<void> = async () => {};

  const loadingBanner = el('p', 'email-stream-loading', 'Loading…');
  loadingBanner.hidden = true;
  const headMount = el('div', 'email-stream-head');
  const followupsMount = el('div', 'email-stream-followups');
  const markerMount = el('div', 'email-stream-marker');
  const markerLabel = el('span', '', scopeMarker(scope));
  const markerTools = el('div', 'email-stream-tools');
  markerMount.append(markerLabel, markerTools);
  const pager = el('div', 'email-stream-pager');
  pager.hidden = true;

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

  /** Publish metadata only; full bodies remain behind fenced mail tools. */
  const publishContext = (): void => {
    options.onContextChange?.({
      accountId: account.id,
      accountLabel: account.label,
      view: scopeContextLabel(scope),
      folder: scopeFolder(scope),
      ...(selectedThreadId ? { threadId: selectedThreadId } : {}),
      ...(selectedThreadSubject ? { threadSubject: selectedThreadSubject } : {}),
      ...(selectedMessageId ? { messageId: selectedMessageId } : {}),
    });
  };
  publishContext();

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

  const loadSummary = async (): Promise<void> => {
    // The summary feeds both the triage head and the rail counts; it is cached
    // server-side, so fetching it for every scope is cheap.
    try {
      const payload = await fetchInboxSummary(account.id);
      summary = payload.summary;
      digest = payload.digest ?? null;
      pendingActions = payload.pendingActions ?? [];
      followups = payload.followups ?? [];
      reportCounts(payload);

      // Cold cache: sync once so triage and the stream have something to show.
      if (scope.kind === 'triage' && payload.summary.text.includes('Sync to fetch new mail')) {
        options.onSyncActivity?.(true);
        try {
          await syncEmailFolder(account.id, 'INBOX');
          const fresh = await fetchInboxSummary(account.id);
          summary = fresh.summary;
          digest = fresh.digest ?? null;
          pendingActions = fresh.pendingActions ?? [];
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
      digest = null;
      pendingActions = [];
    }
  };

  const queryThreads = (offset: number): ReturnType<typeof fetchEmailThreads> =>
    fetchEmailThreads(account.id, {
      folder: scopeFolder(scope),
      offset,
      limit: PAGE,
      filter: scopeFilter(scope),
      query: search || undefined,
    });

  /** Total pages for the current result set (at least one, even when empty). */
  const pageCount = (): number => Math.max(1, Math.ceil(total / PAGE));

  const fetchThreadsPage = async (pageIndex: number): Promise<void> => {
    const result = await queryThreads(pageIndex * PAGE);
    total = result.total;
    threads = result.threads;
  };

  /** Load the page tracked by `page`, clamping if the folder shrank under us. */
  const loadThreadsForPage = async (): Promise<void> => {
    if (scope.kind === 'waiting') {
      threads = [];
      total = 0;
      page = 0;
      return;
    }
    listGeneration += 1;
    await fetchThreadsPage(page);
    // A deletion elsewhere can shrink the folder; if the page we asked for now
    // sits past the end, drop back to the last real page.
    if (page > pageCount() - 1) {
      page = pageCount() - 1;
      await fetchThreadsPage(page);
    }
  };

  /** Jump to another page, commit only if still the latest request, top the list. */
  const goToPage = async (target: number): Promise<void> => {
    const clamped = Math.max(0, Math.min(target, pageCount() - 1));
    if (clamped === page) return;

    const generation = ++listGeneration;
    pager.setAttribute('aria-busy', 'true');
    try {
      const result = await queryThreads(clamped * PAGE);
      if (generation !== listGeneration) return;
      total = result.total;
      threads = result.threads;
      page = clamped;
      // Full re-render so the triage head shows on page 1 and hides beyond it.
      renderStream();
      stream.scrollTop = 0;
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'Could not load that page');
    } finally {
      pager.removeAttribute('aria-busy');
    }
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

    const freshness = el('div', 'email-readout-freshness');
    freshness.setAttribute('role', 'status');
    const refreshBtn = iconBtn(
      EMAIL_ICONS.sync,
      'Refresh inbox',
      'email-icon-btn email-readout-refresh',
    );
    refreshBtn.addEventListener('click', () => void syncAndReload());
    freshness.appendChild(refreshBtn);
    const synced = el('span', 'email-readout-synced', relativeTime(summary.generatedAt));
    synced.title = `Last synced ${new Date(summary.generatedAt).toLocaleString()}`;
    freshness.appendChild(synced);
    readout.appendChild(freshness);
    return readout;
  };

  const renderStreamRow = (thread: EmailThreadSummary, _index: number): HTMLElement => {
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

  const listMount = el('div', 'email-stream-rows');

  const renderEmpty = (): HTMLElement => {
    const empty = el('div', 'email-stream-empty');
    empty.appendChild(el('p', 'email-empty-title', emptyTitle()));
    empty.appendChild(el('p', 'email-empty-copy', emptyCopy()));
    return empty;
  };

  const renderRows = (): void => {
    if (threads.length === 0) {
      listMount.removeAttribute('role');
      listMount.removeAttribute('aria-label');
      listMount.replaceChildren(renderEmpty());
      return;
    }
    listMount.setAttribute('role', 'list');
    listMount.setAttribute('aria-label', 'Conversations');
    const fragment = document.createDocumentFragment();
    threads.forEach((thread, index) => fragment.appendChild(renderStreamRow(thread, index)));
    listMount.replaceChildren(fragment);
  };

  const renderPager = (): void => {
    const pages = pageCount();
    if (scope.kind === 'waiting' || total === 0 || pages <= 1) {
      pager.hidden = true;
      pager.replaceChildren();
      return;
    }
    pager.hidden = false;

    const prev = el('button', 'email-btn email-stream-pager-btn', 'Previous') as HTMLButtonElement;
    prev.type = 'button';
    prev.disabled = page <= 0;
    prev.addEventListener('click', () => void goToPage(page - 1));

    const start = page * PAGE + 1;
    const end = Math.min((page + 1) * PAGE, total);
    const label = el('span', 'email-stream-pager-label', `${start}–${end} of ${total}`);
    label.setAttribute('role', 'status');

    const next = el('button', 'email-btn email-stream-pager-btn', 'Next') as HTMLButtonElement;
    next.type = 'button';
    next.disabled = page >= pages - 1;
    next.addEventListener('click', () => void goToPage(page + 1));

    pager.replaceChildren(prev, label, next);
  };

  streamCol.append(loadingBanner, headMount, followupsMount, markerMount, listMount, pager);

  /** Wire the scope marker search once; input survives reloads. */
  const wireScopeMarkerSearch = (): void => {
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
        page = 0;
        void reload({ showLoading: true, keepFocus: 'search' });
      }, 300);
    });
    searchWrap.appendChild(input);
    markerTools.replaceChildren(searchWrap);
  };
  wireScopeMarkerSearch();

  const renderHead = (): void => {
    headMount.replaceChildren();

    // The instrument readout and triage queue lead the first page only; deeper
    // pages are a plain conversation list.
    if (page !== 0 || !scopeShowsHead(scope) || !summary) return;

    const readout = renderReadout();
    if (readout) headMount.appendChild(readout);

    // Narrative digest leads when available; the heuristic template is the
    // instant fallback until the LLM pass lands via `digest_updated` SSE.
    const narrative = (digest?.narrative ?? '').trim();
    const brief = narrative || (summary.text ?? '').trim();
    if (brief) {
      const briefNode = el('p', 'email-stream-brief', brief);
      if (narrative) briefNode.classList.add('is-narrative');
      headMount.appendChild(briefNode);
    }
    if (digest) {
      renderDigestActionGroups(headMount, account, digest, dashOptions);
    }
    renderPendingActions(headMount, account, pendingActions, dashOptions);

    if (summary.highlights.length > 0) {
      const marker = el('div', 'email-stream-marker', 'Needs attention');
      headMount.appendChild(marker);
      const attn = el('div', 'email-dash-rows');
      for (const highlight of summary.highlights.slice(0, 5)) {
        renderHighlightRow(attn, highlight, account, dashOptions);
      }
      headMount.appendChild(attn);
    }
  };

  const renderStream = (): void => {
    markerLabel.textContent = scopeMarker(scope);
    renderHead();

    const isWaiting = scope.kind === 'waiting';
    followupsMount.hidden = !isWaiting;
    listMount.hidden = isWaiting;
    markerMount.hidden = isWaiting;

    if (isWaiting) {
      pager.hidden = true;
      followupsMount.replaceChildren(renderFollowups());
      return;
    }

    renderRows();
    renderPager();
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
    selectedThreadSubject = '';
    selectedMessageId = '';
    composeMode = null;
    surface.classList.remove('has-reader');
    syncEmailReaderDockResizer(surface);
    renderRows();
    publishContext();
    options.onReaderClosed?.();
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
    selectedThreadSubject = '';
    selectedMessageId = '';
    composeMode = null;
    renderRows();
    publishContext();

    let thread: EmailMessage[];
    try {
      thread = (await fetchEmailThread(account.id, threadId)).messages;
      if (session !== emailInboxSession) return;
      thread = await hydrateThreadBodies(account.id, thread);
      if (session !== emailInboxSession) return;
    } catch (err) {
      if (session !== emailInboxSession) return;
      options.onStatus?.('err', err instanceof Error ? err.message : 'Could not open the conversation');
      return;
    }
    const selected = thread[thread.length - 1];
    if (!selected || session !== emailInboxSession) return;
    selectedThreadSubject = selected.subject || '(no subject)';
    selectedMessageId = selected.id;
    publishContext();

    if (!selected.flags?.seen) {
      void setEmailMessageFlags(account.id, selected.id, { seen: true }).then(
        () => reportCountsAfterSeen(),
        () => undefined,
      );
    }

    dockBody.replaceChildren();
    const close = iconBtn(EMAIL_ICONS.close, 'Close', 'email-icon-btn email-reader-dock-close');
    close.addEventListener('click', () => closeReader());
    dockBody.appendChild(close);

    const scrollArea = el('div', 'email-reader-dock-scroll');
    dockBody.appendChild(scrollArea);

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
    syncEmailReaderDockResizer(surface);
  };

  /** After marking a message seen, nudge the rail's unread badge down. */
  const reportCountsAfterSeen = async (): Promise<void> => {
    try {
      const payload = await fetchInboxSummary(account.id);
      summary = payload.summary;
      digest = payload.digest ?? null;
      pendingActions = payload.pendingActions ?? [];
      followups = payload.followups ?? [];
      reportCounts(payload);
    } catch {
      // A failed refresh just leaves the badge as it was.
    }
  };

  // ---- Reload ----------------------------------------------------------
  syncAndReload = async (): Promise<void> => {
    const folder = scopeFolder(scope);
    const refreshBtn = headMount.querySelector<HTMLButtonElement>('.email-readout-refresh');
    refreshBtn?.classList.add('is-syncing');
    options.onSyncActivity?.(true);
    try {
      const result = await syncEmailFolder(account.id, folder);
      options.onStatus?.('ok', `Synced ${result.synced} messages`);
      const openThreadId = selectedThreadId;
      await reload({ showLoading: false });
      if (openThreadId) {
        void openThread(openThreadId);
      }
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'Sync failed');
    } finally {
      refreshBtn?.classList.remove('is-syncing');
      options.onSyncActivity?.(false);
    }
  };

  const reload = async (opts?: { showLoading?: boolean; keepFocus?: 'search' }): Promise<void> => {
    if (opts?.showLoading) {
      loadingBanner.hidden = false;
      loadingBanner.textContent = 'Loading…';
    }
    try {
      await loadSummary();
      await loadThreadsForPage();
      renderStream();
      if (opts?.showLoading) stream.scrollTop = 0;
      if (opts?.keepFocus === 'search') {
        markerTools.querySelector<HTMLInputElement>('.email-stream-search input')?.focus();
      }
      loadingBanner.hidden = true;
    } catch (err) {
      loadingBanner.hidden = false;
      loadingBanner.textContent = err instanceof Error ? err.message : 'Load failed';
    }
  };

  // ---- Boot ------------------------------------------------------------
  loadingBanner.hidden = false;
  await reload({ showLoading: false });

  if (options.openComposeNew) {
    dockBody.replaceChildren();
    const close = iconBtn(EMAIL_ICONS.close, 'Close', 'email-icon-btn email-reader-dock-close');
    close.addEventListener('click', () => closeReader());
    const scrollArea = el('div', 'email-reader-dock-scroll');
    const header = el('header', 'email-reader-head');
    header.appendChild(el('h2', 'email-reader-subject', 'New message'));
    scrollArea.appendChild(header);
    const composeMount = el('div', 'email-reader-compose-mount');
    scrollArea.appendChild(composeMount);
    dockBody.append(close, scrollArea);
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
    syncEmailReaderDockResizer(surface);
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
