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
  bulkEmailAction,
  deleteEmailMessage,
  fetchEmailFolders,
  fetchInboxSummary,
  markAllEmailRead,
  moveEmailMessage,
  requestThreadSummary,
  setEmailMessageFlags,
} from '../../email/client-ext';
import { snoozeEmailMessage } from '../../email/client-drafts';
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
import { bindMailShortcuts, showShortcutCheatSheet } from './email-keyboard';
import { openEmailContextMenu, closeEmailContextMenu } from './email-context-menu';
import {
  canAcceptEmailDrop,
  clearEmailSelection,
  collectMessageIdsForThreads,
  createEmailSelection,
  EMAIL_DRAG_MIME,
  encodeEmailDragPayload,
  masterCheckboxState,
  pruneEmailSelection,
  resolveActionTargetIds,
  resolveDragThreadIds,
  selectEmailPage,
  selectEmailFolder,
  selectEmailShiftRange,
  selectionDisplayCount,
  selectionReadAction,
  selectionStarAction,
  shouldOfferFolderSelect,
  toggleEmailSelection,
  type EmailDragPayload,
} from './email-selection';

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
  /** Mount the assistant open toggle beside the readout or stream marker. */
  onAssistantToggleMount?: (slot: HTMLElement) => void;
  /** Called once the inbox surface is live so SSE can refresh without remounting. */
  onReady?: (handle: EmailInboxHandle) => void;
}

export interface EmailInboxHandle {
  refresh: () => Promise<void>;
  /** Move dragged (or selected) conversations into a rail folder. */
  applyFolderDrop: (destFolder: string, payload: EmailDragPayload) => Promise<void>;
}

/** Bumped on every full inbox remount; stale openThread calls bail after this changes. */
let emailInboxSession = 0;
/** Tear down the previous mount's shortcut binder before attaching a new one. */
let emailInboxShortcutTeardown: (() => void) | null = null;

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
  if (scope.kind === 'filter') return scope.filter;
  // The triage "Everything else" list is unread-only; highlights cover urgent mail.
  if (scope.kind === 'triage') return 'unread';
  return undefined;
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
  /** Checkbox selection for bulk actions (distinct from the open reader thread). */
  const selection = createEmailSelection();
  /** Folder-scoped message ids for threads not on the current page (folder-wide select). */
  const folderThreadCache = new Map<string, string[]>();
  /** Thread summaries loaded for folder-wide selection (read/star toolbar labels). */
  let folderThreadSummaries: EmailThreadSummary[] = [];
  /** True while every thread id in the folder is being resolved for selection. */
  let folderSelectBusy = false;

  const resetSelection = (): void => {
    clearEmailSelection(selection);
    folderThreadCache.clear();
    folderThreadSummaries = [];
  };

  const threadsForSelectionActions = (): EmailThreadSummary[] =>
    selection.allInFolder && folderThreadSummaries.length > 0 ? folderThreadSummaries : threads;
  /** Keyboard focus index within the current page (-1 = none). */
  let focusIndex = -1;
  /** True while a bulk request is in flight (disables the action bar). */
  let bulkBusy = false;
  /** Cached folder list for Move / drop destination menus. */
  let folderRows: Array<{ path: string; name: string }> = [];
  /** Assigned after `reload` is defined; the readout refresh button calls this. */
  let syncAndReload: () => Promise<void> = async () => {};

  const loadingBanner = el('p', 'email-stream-loading', 'Loading…');
  loadingBanner.hidden = true;
  const headMount = el('div', 'email-stream-head');
  const followupsMount = el('div', 'email-stream-followups');
  const markerMount = el('div', 'email-stream-marker');
  const markerLabel = el('span', '', scopeMarker(scope));
  const markerTools = el('div', 'email-stream-tools');
  // Sit outside the tools cluster so CSS can pin it past the marker hairline.
  const markerAssistantSlot = el('div', 'email-readout-actions email-stream-assistant');
  markerMount.append(markerLabel, markerTools, markerAssistantSlot);
  const pager = el('div', 'email-stream-pager');
  pager.hidden = true;
  const selectBannerMount = el('div', 'email-stream-select-banner-mount');

  /** Page thread ids in list order (for Shift-range and master checkbox). */
  const pageIds = (): string[] => threads.map((row) => row.threadId);

  /** Resolve folder-scoped message ids for a set of thread ids. */
  const messageIdsFor = (threadIds: Iterable<string>): string[] => {
    if (!selection.allInFolder) {
      return collectMessageIdsForThreads(threads, threadIds);
    }
    const ids: string[] = [];
    for (const threadId of threadIds) {
      const onPage = threads.find((row) => row.threadId === threadId);
      if (onPage?.messageIds?.length) {
        ids.push(...onPage.messageIds);
        continue;
      }
      const cached = folderThreadCache.get(threadId);
      if (cached?.length) ids.push(...cached);
    }
    return ids;
  };

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

  /** Prefer the readout freshness row; fall back to the stream marker toolbar. */
  const mountAssistantToggle = (preferred: HTMLElement | null): void => {
    options.onAssistantToggleMount?.(preferred ?? markerAssistantSlot);
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

  /** Load every conversation in the current folder/view for folder-wide selection. */
  const selectAllInFolder = async (): Promise<void> => {
    if (folderSelectBusy || bulkBusy || total === 0) return;
    folderSelectBusy = true;
    paintSelectBanner();
    paintToolbar();
    try {
      const collected: EmailThreadSummary[] = [];
      let offset = 0;
      const limit = 200;
      while (offset < total) {
        const result = await fetchEmailThreads(account.id, {
          folder: scopeFolder(scope),
          offset,
          limit,
          filter: scopeFilter(scope),
          query: search || undefined,
        });
        collected.push(...result.threads);
        offset += result.threads.length;
        if (result.threads.length === 0) break;
      }
      folderThreadCache.clear();
      const ids: string[] = [];
      for (const row of collected) {
        ids.push(row.threadId);
        if (row.messageIds?.length) folderThreadCache.set(row.threadId, row.messageIds);
      }
      folderThreadSummaries = collected;
      selectEmailFolder(selection, ids, total);
      paintToolbar();
      paintSelectBanner();
      renderRows();
    } catch (err) {
      options.onStatus?.(
        'err',
        err instanceof Error ? err.message : 'Could not select every conversation',
      );
    } finally {
      folderSelectBusy = false;
      paintSelectBanner();
      paintToolbar();
    }
  };

  /** Total pages for the current result set (at least one, even when empty). */
  const pageCount = (): number => Math.max(1, Math.ceil(total / PAGE));

  /** Gmail-style banner: expand page selection to the whole folder, or undo. */
  let paintSelectBanner: () => void = () => {};

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
      // Page changes clear page-only selection; folder-wide selection persists.
      if (!selection.allInFolder) {
        resetSelection();
      }
      focusIndex = -1;
      closeEmailContextMenu();
      // Full re-render so the triage head shows on page 1 and hides beyond it.
      renderStream();
      stream.scrollTop = 0;
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'Could not load that page');
    } finally {
      pager.removeAttribute('aria-busy');
    }
  };

  /** Deterministic snooze presets from the productivity plan. */
  const snoozePresets = (): Array<{ label: string; at: () => Date }> => [
    {
      label: 'Later today',
      at: () => {
        const when = new Date();
        when.setHours(when.getHours() + 3, 0, 0, 0);
        return when;
      },
    },
    {
      label: 'Tomorrow morning',
      at: () => {
        const when = new Date();
        when.setDate(when.getDate() + 1);
        when.setHours(9, 0, 0, 0);
        return when;
      },
    },
    {
      label: 'Next Monday',
      at: () => {
        const when = new Date();
        const day = when.getDay();
        const daysUntil = ((1 - day + 7) % 7) || 7;
        when.setDate(when.getDate() + daysUntil);
        when.setHours(9, 0, 0, 0);
        return when;
      },
    },
    {
      label: 'In one week',
      at: () => {
        const when = new Date();
        when.setDate(when.getDate() + 7);
        when.setHours(9, 0, 0, 0);
        return when;
      },
    },
  ];

  /** Run a bulk action against folder-scoped message ids, with undo where possible. */
  const runBulk = async (
    threadIds: string[],
    action: 'read' | 'unread' | 'flag' | 'unflag' | 'archive' | 'delete' | 'move' | 'spam',
    label: string,
    destFolder?: string,
  ): Promise<void> => {
    const ids = messageIdsFor(threadIds);
    if (ids.length === 0) {
      options.onStatus?.('err', 'No messages to update in this folder');
      return;
    }
    if (bulkBusy) return;
    bulkBusy = true;
    paintToolbar();
    try {
      const result = await bulkEmailAction({
        accountId: account.id,
        ids,
        action,
        destFolder,
      });
      if (result.failed > 0) {
        options.onStatus?.(
          'err',
          `${result.failed} of ${ids.length} failed — reloading`,
        );
        await reload({ showLoading: false });
        return;
      }
      resetSelection();
      focusIndex = -1;
      options.onStatus?.('ok', label);
      if (
        action === 'archive' ||
        action === 'delete' ||
        action === 'move' ||
        action === 'spam'
      ) {
        const undoIds = [...ids];
        showActionUndoToast(label, {
          onUndo: async () => {
            await bulkEmailAction({
              accountId: account.id,
              ids: undoIds,
              action: 'move',
              destFolder: scopeFolder(scope),
            });
            await reload({ showLoading: false });
          },
          onStatus: options.onStatus,
        });
      }
      await loadSummary();
      await loadThreadsForPage();
      if (!selection.allInFolder) {
        pruneEmailSelection(selection, pageIds());
      }
      renderStream();
    } catch (err) {
      options.onStatus?.(
        'err',
        err instanceof Error ? err.message : 'Bulk action failed',
      );
    } finally {
      bulkBusy = false;
      paintToolbar();
    }
  };

  /** Move thread ids to a destination folder (toolbar, menu, or drop). */
  const moveThreads = async (threadIds: string[], destFolder: string): Promise<void> => {
    if (!destFolder || destFolder === scopeFolder(scope)) return;
    await runBulk(
      threadIds,
      'move',
      `Moved ${threadIds.length} conversation${threadIds.length === 1 ? '' : 's'}`,
      destFolder,
    );
  };

  /** Apply a rail folder drop using the same move path as the toolbar. */
  const applyFolderDrop = async (
    destFolder: string,
    payload: EmailDragPayload,
  ): Promise<void> => {
    if (
      !canAcceptEmailDrop(payload, {
        accountId: account.id,
        folderPath: destFolder,
      })
    ) {
      return;
    }
    await moveThreads(payload.threadIds, destFolder);
  };

  /** Snooze every folder-scoped message in the given threads. */
  const snoozeThreads = async (threadIds: string[], until: Date): Promise<void> => {
    const ids = messageIdsFor(threadIds);
    if (ids.length === 0) {
      options.onStatus?.('err', 'No messages to snooze in this folder');
      return;
    }
    if (bulkBusy) return;
    bulkBusy = true;
    paintToolbar();
    try {
      let failed = 0;
      for (const id of ids) {
        try {
          await snoozeEmailMessage(account.id, id, until.toISOString());
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) {
        options.onStatus?.('err', `${failed} of ${ids.length} failed to snooze`);
        await reload({ showLoading: false });
        return;
      }
      resetSelection();
      options.onStatus?.('ok', `Snoozed until ${formatWhen(until.toISOString())}`);
      await reload({ showLoading: false });
    } finally {
      bulkBusy = false;
      paintToolbar();
    }
  };

  /** Mark all unread in the current Unread scope (not only the visible page). */
  const markAllRead = async (): Promise<void> => {
    if (bulkBusy) return;
    bulkBusy = true;
    paintToolbar();
    try {
      const result = await markAllEmailRead(account.id, {
        folder: scopeFolder(scope),
        query: search || undefined,
      });
      if (result.attempted === 0) {
        options.onStatus?.('ok', 'No unread mail');
      } else if (result.failed > 0) {
        options.onStatus?.(
          'err',
          `${result.failed} of ${result.attempted} failed — reloading`,
        );
      } else {
        options.onStatus?.(
          'ok',
          `Marked ${result.updated} message${result.updated === 1 ? '' : 's'} read`,
        );
      }
      resetSelection();
      await reload({ showLoading: false });
    } catch (err) {
      options.onStatus?.(
        'err',
        err instanceof Error ? err.message : 'Could not mark all as read',
      );
    } finally {
      bulkBusy = false;
      paintToolbar();
    }
  };

  /** Pop a lightweight menu of folder destinations near an anchor button. */
  const openMoveMenu = (
    anchor: HTMLElement,
    threadIds: string[],
  ): void => {
    const destinations = folderRows.filter((row) => row.path !== scopeFolder(scope));
    const rect = anchor.getBoundingClientRect();
    openEmailContextMenu({
      clientX: rect.left,
      clientY: rect.bottom + 4,
      restoreFocus: anchor,
      items:
        destinations.length === 0
          ? [
              {
                id: 'empty',
                label: 'No folders available',
                disabled: true,
                onSelect: () => undefined,
              },
            ]
          : destinations.map((row) => ({
              id: row.path,
              label: folderLabel(row.path),
              onSelect: () => void moveThreads(threadIds, row.path),
            })),
    });
  };

  /** Pop snooze presets near an anchor button. */
  const openSnoozeMenu = (anchor: HTMLElement, threadIds: string[]): void => {
    const rect = anchor.getBoundingClientRect();
    openEmailContextMenu({
      clientX: rect.left,
      clientY: rect.bottom + 4,
      restoreFocus: anchor,
      items: snoozePresets().map((preset) => ({
        id: preset.label,
        label: preset.label,
        onSelect: () => void snoozeThreads(threadIds, preset.at()),
      })),
    });
  };

  /** Open the row context menu for one conversation (or its selection group). */
  const openRowMenu = (
    thread: EmailThreadSummary,
    clientX: number,
    clientY: number,
    restoreFocus: HTMLElement,
  ): void => {
    // Unselected row → act on that row alone without rewriting the checkbox set.
    const targets = resolveActionTargetIds(selection.selected, thread.threadId);
    const targetSet = new Set(targets);
    const readAction = selectionReadAction(threads, targetSet);
    const starAction = selectionStarAction(threads, targetSet);
    openEmailContextMenu({
      clientX,
      clientY,
      restoreFocus,
      items: [
        {
          id: 'open',
          label: 'Open',
          onSelect: () => void openThread(thread.threadId),
        },
        {
          id: 'read',
          label: readAction === 'read' ? 'Mark read' : 'Mark unread',
          onSelect: () =>
            void runBulk(
              targets,
              readAction,
              readAction === 'read' ? 'Marked read' : 'Marked unread',
            ),
        },
        {
          id: 'star',
          label: starAction === 'flag' ? 'Star' : 'Unstar',
          onSelect: () =>
            void runBulk(
              targets,
              starAction,
              starAction === 'flag' ? 'Starred' : 'Unstarred',
            ),
        },
        {
          id: 'archive',
          label: 'Archive',
          onSelect: () => void runBulk(targets, 'archive', 'Archived'),
        },
        {
          id: 'snooze',
          label: 'Snooze…',
          onSelect: () => openSnoozeMenu(restoreFocus, targets),
        },
        {
          id: 'move',
          label: 'Move to…',
          onSelect: () => openMoveMenu(restoreFocus, targets),
        },
        {
          id: 'spam',
          label: 'Report spam',
          onSelect: () => void runBulk(targets, 'spam', 'Reported as spam'),
        },
        {
          id: 'trash',
          label: 'Trash',
          danger: true,
          onSelect: () => void runBulk(targets, 'delete', 'Trashed'),
        },
      ],
    });
  };

  /** Keep the master checkbox + action buttons in sync with selection. */
  let paintToolbar: () => void = () => {};

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
    // Keep the assistant on the far right of the readout row, past freshness.
    const assistantSlot = el('div', 'email-readout-actions email-readout-assistant-slot');
    readout.append(freshness, assistantSlot);
    return readout;
  };

  const renderStreamRow = (thread: EmailThreadSummary, index: number): HTMLElement => {
    const model = toConversationRow(thread);
    const checked = selection.selected.has(thread.threadId);
    const row = el('div', 'email-stream-row');
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', checked ? 'true' : 'false');
    row.dataset.threadId = thread.threadId;
    row.tabIndex = focusIndex === index ? 0 : -1;
    row.classList.toggle('is-unread', model.unread);
    row.classList.toggle('is-checked', checked);
    row.classList.toggle('is-open', thread.threadId === selectedThreadId);
    row.classList.toggle('is-focus', focusIndex === index);
    row.draggable = true;

    const checkbox = el('input', 'email-stream-row-cb') as HTMLInputElement;
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.setAttribute('aria-label', `Select ${model.subject}`);
    checkbox.addEventListener('click', (event) => {
      event.stopPropagation();
      // Handle selection on click so Shift/Ctrl modifiers are available.
      event.preventDefault();
      if (event.shiftKey) {
        selectEmailShiftRange(selection, pageIds(), thread.threadId);
      } else {
        toggleEmailSelection(selection, thread.threadId, { additive: true });
      }
      paintToolbar();
      renderRows();
    });
    row.appendChild(checkbox);

    const openBtn = el('button', 'email-stream-row-open') as HTMLButtonElement;
    openBtn.type = 'button';
    openBtn.setAttribute('aria-label', `Open ${model.subject}`);
    openBtn.appendChild(
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
    openBtn.appendChild(main);
    openBtn.addEventListener('click', (event) => {
      if (event.shiftKey) {
        event.preventDefault();
        selectEmailShiftRange(selection, pageIds(), thread.threadId);
        paintToolbar();
        renderRows();
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        toggleEmailSelection(selection, thread.threadId, { additive: true });
        paintToolbar();
        renderRows();
        return;
      }
      void openThread(thread.threadId);
    });
    row.appendChild(openBtn);

    const meta = el('div', 'email-stream-row-meta');
    const starBtn = iconBtn(
      model.flagged ? EMAIL_ICONS.starFilled : EMAIL_ICONS.star,
      model.flagged ? 'Unstar' : 'Star',
      'email-icon-btn email-stream-row-star',
    );
    starBtn.classList.toggle('is-active', model.flagged);
    starBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      void runBulk(
        [thread.threadId],
        model.flagged ? 'unflag' : 'flag',
        model.flagged ? 'Unstarred' : 'Starred',
      );
    });
    meta.appendChild(starBtn);
    if (model.unread) meta.appendChild(el('span', 'email-stream-row-dot'));
    if (model.hasAttachments) {
      const attach = el('span', 'email-stream-row-attach');
      attach.innerHTML = EMAIL_ICONS.attach;
      attach.title = 'Has attachments';
      meta.appendChild(attach);
    }
    meta.appendChild(el('span', 'email-stream-row-date', formatWhen(model.date)));
    row.appendChild(meta);

    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openRowMenu(thread, event.clientX, event.clientY, openBtn);
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        const rect = openBtn.getBoundingClientRect();
        openRowMenu(thread, rect.left + 8, rect.bottom + 4, openBtn);
      }
    });

    row.addEventListener('dragstart', (event) => {
      const dragIds = resolveDragThreadIds(selection.selected, thread.threadId);
      const payload = encodeEmailDragPayload({
        accountId: account.id,
        sourceFolder: scopeFolder(scope),
        threadIds: dragIds,
      });
      event.dataTransfer?.setData(EMAIL_DRAG_MIME, payload);
      event.dataTransfer?.setData('text/plain', `${dragIds.length} conversation(s)`);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      row.classList.add('is-dragging');
      for (const id of dragIds) {
        listMount
          .querySelector(`[data-thread-id="${CSS.escape(id)}"]`)
          ?.classList.add('is-dragging');
      }
    });
    row.addEventListener('dragend', () => {
      listMount
        .querySelectorAll('.email-stream-row.is-dragging')
        .forEach((node) => node.classList.remove('is-dragging'));
    });

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
    listMount.setAttribute('role', 'listbox');
    listMount.setAttribute('aria-label', 'Conversations');
    listMount.setAttribute('aria-multiselectable', 'true');
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

  streamCol.append(loadingBanner, headMount, followupsMount, markerMount, selectBannerMount, listMount, pager);

  /**
   * Scope-marker toolbar: master checkbox, selection actions or idle tools
   * (refresh / Read all / search / help), plus the assistant mount slot.
   */
  paintToolbar = (): void => {
    const tools = el('div', 'email-stream-toolbar');
    tools.classList.toggle('is-busy', bulkBusy || folderSelectBusy);

    const master = el('input', 'email-stream-master-cb') as HTMLInputElement;
    master.type = 'checkbox';
    master.title = selection.allInFolder ? 'Clear selection' : 'Select all on this page';
    master.setAttribute(
      'aria-label',
      selection.allInFolder ? 'Clear conversation selection' : 'Select all conversations on this page',
    );
    const masterState = masterCheckboxState(selection.selected, pageIds());
    master.checked = selection.allInFolder || masterState === 'all';
    master.indeterminate = !selection.allInFolder && masterState === 'some';
    master.disabled = bulkBusy || folderSelectBusy || threads.length === 0;
    master.addEventListener('change', () => {
      if (master.checked) selectEmailPage(selection, pageIds());
      else resetSelection();
      paintToolbar();
      paintSelectBanner();
      renderRows();
    });
    tools.appendChild(master);

    const actions = el('div', 'email-stream-actions');
    const hasSelection = selection.selected.size > 0;

    if (hasSelection) {
      const count = el(
        'span',
        'email-stream-selection-count',
        `${selectionDisplayCount(selection)} selected`,
      );
      count.setAttribute('role', 'status');
      actions.appendChild(count);

      const selectedIds = [...selection.selected];
      const actionThreads = threadsForSelectionActions();
      const readAction = selectionReadAction(actionThreads, selection.selected);
      const starAction = selectionStarAction(actionThreads, selection.selected);

      const mkAction = (
        svg: string,
        label: string,
        onClick: (btn: HTMLButtonElement) => void,
        danger = false,
      ): void => {
        const btn = iconBtn(svg, label);
        if (danger) btn.classList.add('email-icon-btn--danger');
        btn.disabled = bulkBusy;
        btn.addEventListener('click', () => onClick(btn));
        actions.appendChild(btn);
      };

      mkAction(
        readAction === 'read' ? EMAIL_ICONS.mailOpen : EMAIL_ICONS.mail,
        readAction === 'read' ? 'Mark read' : 'Mark unread',
        () =>
          void runBulk(
            selectedIds,
            readAction,
            readAction === 'read' ? 'Marked read' : 'Marked unread',
          ),
      );
      mkAction(
        starAction === 'flag' ? EMAIL_ICONS.star : EMAIL_ICONS.starFilled,
        starAction === 'flag' ? 'Star' : 'Unstar',
        () =>
          void runBulk(
            selectedIds,
            starAction,
            starAction === 'flag' ? 'Starred' : 'Unstarred',
          ),
      );
      mkAction(EMAIL_ICONS.archive, 'Archive', () =>
        void runBulk(selectedIds, 'archive', 'Archived'),
      );
      mkAction(EMAIL_ICONS.spam, 'Report spam', () =>
        void runBulk(selectedIds, 'spam', 'Reported as spam'),
      );
      mkAction(
        EMAIL_ICONS.trash,
        'Trash',
        () => void runBulk(selectedIds, 'delete', 'Trashed'),
        true,
      );
      mkAction(EMAIL_ICONS.snooze, 'Snooze', (btn) => openSnoozeMenu(btn, selectedIds));
      mkAction(EMAIL_ICONS.move, 'Move to folder', (btn) => openMoveMenu(btn, selectedIds));
      mkAction(EMAIL_ICONS.close, 'Clear selection', () => {
        resetSelection();
        paintToolbar();
        paintSelectBanner();
        renderRows();
      });
    } else {
      const refreshBtn = iconBtn(EMAIL_ICONS.sync, 'Refresh');
      refreshBtn.disabled = bulkBusy;
      refreshBtn.addEventListener('click', () => void syncAndReload());
      actions.appendChild(refreshBtn);

      if (scope.kind === 'filter' && scope.filter === 'unread') {
        const readAll = el('button', 'email-btn email-stream-read-all', 'Read all') as HTMLButtonElement;
        readAll.type = 'button';
        readAll.title = 'Mark all unread in this view as read';
        readAll.disabled = bulkBusy;
        readAll.addEventListener('click', () => void markAllRead());
        actions.appendChild(readAll);
      }

      const helpBtn = iconBtn(EMAIL_ICONS.help, 'Keyboard shortcuts');
      helpBtn.addEventListener('click', () => showShortcutCheatSheet(surface));
      actions.appendChild(helpBtn);
    }

    tools.appendChild(actions);

    const searchWrap = el('label', 'email-stream-search');
    searchWrap.innerHTML = EMAIL_ICONS.search;
    const input = el('input') as HTMLInputElement;
    input.type = 'search';
    input.value = search;
    input.placeholder = 'Search';
    input.setAttribute('aria-label', 'Search mail');
    input.disabled = bulkBusy;
    let timer: number | undefined;
    input.addEventListener('input', () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        search = input.value.trim();
        page = 0;
        resetSelection();
        focusIndex = -1;
        void reload({ showLoading: true, keepFocus: 'search' });
      }, 300);
    });
    searchWrap.appendChild(input);

    markerTools.replaceChildren(tools, searchWrap);
  };

  paintSelectBanner = (): void => {
    selectBannerMount.replaceChildren();
    if (scope.kind === 'waiting' || total === 0) return;

    const scopeName = scopeMarker(scope);
    const pageCountOnScreen = pageIds().length;

    if (selection.allInFolder) {
      const banner = el('div', 'email-stream-select-banner');
      banner.setAttribute('role', 'status');
      banner.append(
        `${selection.folderTotal ?? total} conversation${(selection.folderTotal ?? total) === 1 ? '' : 's'} in ${scopeName} selected. `,
      );
      const undo = el('button', 'email-stream-select-banner-action', 'Clear selection') as HTMLButtonElement;
      undo.type = 'button';
      undo.disabled = bulkBusy || folderSelectBusy;
      undo.addEventListener('click', () => {
        resetSelection();
        paintToolbar();
        paintSelectBanner();
        renderRows();
      });
      banner.appendChild(undo);
      selectBannerMount.appendChild(banner);
      return;
    }

    if (!shouldOfferFolderSelect(selection, pageIds(), total)) return;

    const banner = el('div', 'email-stream-select-banner');
    banner.setAttribute('role', 'status');
    banner.append(
      `All ${pageCountOnScreen} conversation${pageCountOnScreen === 1 ? '' : 's'} on this page ${pageCountOnScreen === 1 ? 'is' : 'are'} selected. `,
    );
    const expand = el(
      'button',
      'email-stream-select-banner-action',
      `Select all ${total} in ${scopeName}`,
    ) as HTMLButtonElement;
    expand.type = 'button';
    expand.disabled = bulkBusy || folderSelectBusy;
    expand.addEventListener('click', () => void selectAllInFolder());
    banner.appendChild(expand);
    selectBannerMount.appendChild(banner);
  };

  paintToolbar();
  paintSelectBanner();
  mountAssistantToggle(markerAssistantSlot);

  const renderHead = (): void => {
    headMount.replaceChildren();

    // The instrument readout and triage queue lead the first page only; deeper
    // pages are a plain conversation list.
    if (page !== 0 || !scopeShowsHead(scope) || !summary) {
      mountAssistantToggle(markerAssistantSlot);
      return;
    }

    const readout = renderReadout();
    if (readout) {
      headMount.appendChild(readout);
      mountAssistantToggle(
        readout.querySelector<HTMLElement>('.email-readout-assistant-slot'),
      );
    } else {
      mountAssistantToggle(markerAssistantSlot);
    }

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
    if (!selection.allInFolder) {
      pruneEmailSelection(selection, pageIds());
    }
    renderHead();
    paintToolbar();
    paintSelectBanner();

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
    if (scopeFilter(scope) === 'unread') return "You're all caught up";
    return 'Nothing here';
  };
  const emptyCopy = (): string => {
    if (search) return 'No conversations match that search. Try fewer words.';
    if (scope.kind === 'filter' || scope.kind === 'triage') {
      return 'Nothing matches this view right now.';
    }
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
    const reloadSession = session;
    if (opts?.showLoading) {
      loadingBanner.hidden = false;
      loadingBanner.textContent = 'Loading…';
    }
    try {
      await loadSummary();
      if (reloadSession !== emailInboxSession) return;
      await loadThreadsForPage();
      if (reloadSession !== emailInboxSession) return;
      renderStream();
      if (opts?.showLoading) stream.scrollTop = 0;
      if (opts?.keepFocus === 'search') {
        markerTools.querySelector<HTMLInputElement>('.email-stream-search input')?.focus();
      }
      loadingBanner.hidden = true;
    } catch (err) {
      if (reloadSession !== emailInboxSession) return;
      loadingBanner.hidden = false;
      loadingBanner.textContent = err instanceof Error ? err.message : 'Load failed';
    }
  };

  // ---- Keyboard shortcuts (Gmail-compatible; suppressed while typing) ----
  const focusedThread = (): EmailThreadSummary | null =>
    focusIndex >= 0 && focusIndex < threads.length ? threads[focusIndex]! : null;

  const moveFocus = (delta: number): void => {
    if (threads.length === 0) return;
    focusIndex = Math.max(0, Math.min(threads.length - 1, (focusIndex < 0 ? 0 : focusIndex) + delta));
    renderRows();
    listMount
      .querySelector<HTMLElement>(`.email-stream-row.is-focus`)
      ?.focus();
  };

  emailInboxShortcutTeardown?.();
  emailInboxShortcutTeardown = bindMailShortcuts(surface, {
    next: () => moveFocus(1),
    previous: () => moveFocus(-1),
    open: () => {
      const thread = focusedThread();
      if (thread) void openThread(thread.threadId);
    },
    back: () => closeReader(),
    archive: () => {
      const ids =
        selection.selected.size > 0
          ? [...selection.selected]
          : focusedThread()
            ? [focusedThread()!.threadId]
            : [];
      if (ids.length) void runBulk(ids, 'archive', 'Archived');
    },
    trash: () => {
      const ids =
        selection.selected.size > 0
          ? [...selection.selected]
          : focusedThread()
            ? [focusedThread()!.threadId]
            : [];
      if (ids.length) void runBulk(ids, 'delete', 'Trashed');
    },
    star: () => {
      const thread = focusedThread();
      if (!thread) return;
      void runBulk(
        selection.selected.has(thread.threadId)
          ? [...selection.selected]
          : [thread.threadId],
        thread.flagged ? 'unflag' : 'flag',
        thread.flagged ? 'Unstarred' : 'Starred',
      );
    },
    select: () => {
      const thread = focusedThread();
      if (!thread) return;
      toggleEmailSelection(selection, thread.threadId, { additive: true });
      paintToolbar();
      renderRows();
    },
    reply: () => undefined,
    replyAll: () => undefined,
    forward: () => undefined,
    compose: () => undefined,
    search: () => {
      markerTools.querySelector<HTMLInputElement>('.email-stream-search input')?.focus();
    },
    undo: () => undefined,
    help: () => showShortcutCheatSheet(surface),
  });

  // ---- Boot ------------------------------------------------------------
  loadingBanner.hidden = false;
  try {
    folderRows = await fetchEmailFolders(account.id);
  } catch {
    folderRows = (account.folders ?? []).map((path) => ({ path, name: path }));
  }
  await reload({ showLoading: false });
  if (session !== emailInboxSession) return;
  options.onReady?.({
    refresh: () => reload({ showLoading: false }),
    applyFolderDrop,
  });

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
