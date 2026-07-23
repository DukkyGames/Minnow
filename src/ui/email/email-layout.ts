/**

 * Three-pane mail layout — folders, message list, reading pane.

 */

import type {
  EmailAccount,
  EmailMessage,
  EmailThreadSummary,
} from "../../email/client";

import {
  allowImagesFromSender,
  downloadEmailAttachment,
  fetchEmailThread,
  fetchEmailThreads,
  fetchImageAllowlist,
  normalizeSender,
  saveBlobAs,
  syncEmailFolder,
} from "../../email/client";

import {
  archiveEmailMessage,
  bulkEmailAction,
  deleteEmailMessage,
  fetchEmailFolders,
  fetchEmailMessagesExtended,
  fetchInboxSummary,
  moveEmailMessage,
  requestThreadSummary,
  setEmailMessageFlags,
} from "../../email/client-ext";

import { mountEmailCompose, type ComposeMode } from "./email-compose";

import {
  emailBodySupportsViewToggle,
  renderEmailBody,
  type EmailBodyViewMode,
} from "./email-body";

import { EMAIL_ICONS } from "./email-icons";

import { createMailStore } from "./email-store";

import { toConversationRow } from "./email-conversation-row";

import { createVirtualList } from "./email-virtual-list";

import {
  bindMailShortcuts,
  showShortcutCheatSheet,
} from "./email-keyboard";

import { showActionUndoToast } from "./email-undo-toast";

import { snoozeEmailMessage } from "../../email/client-drafts";

/**
 * Row height, in px. Must match `.email-list-row` in email.css — the virtual
 * list does its arithmetic from this rather than measuring.
 */
const LIST_ROW_HEIGHT = 64;

/**
 * Senders allowed to load remote images, cached for the session. `null` until
 * the first fetch resolves — bodies paint blocked in the meantime, so a slow
 * request can never cause images to load before the allowlist is known.
 */
let imageAllowlist: string[] | null = null;

/** Messages the user opted into for this session only ("Load images" once). */
const imagesLoadedFor = new Set<string>();

/** Attachments we can show inline rather than only offer as a download. */
export function previewKind(contentType: string, filename: string): "image" | "pdf" | null {
  const ct = (contentType || "").toLowerCase();
  if (ct.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filename)) return "image";
  if (ct === "application/pdf" || /\.pdf$/i.test(filename)) return "pdf";
  return null;
}

/** Attachment sizes, in the units a person reads them in. */
export function formatBytes(bytes: number): string {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export interface EmailLayoutOptions {
  account: EmailAccount;

  initialThreadId?: string;

  onStatus?: (state: "ok" | "err", message: string) => void;

  /** Toggle the chrome sync progress bar (ref-counted by the panel). */
  onSyncActivity?: (active: boolean) => void;
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

/** Build an icon button with accessible label. */

function iconBtn(
  svg: string,
  label: string,
  className = "email-icon-btn",
): HTMLButtonElement {
  const btn = el("button", className) as HTMLButtonElement;

  btn.type = "button";

  btn.title = label;

  btn.setAttribute("aria-label", label);

  btn.innerHTML = svg;

  return btn;
}

/**
 * Render one message body plus the remote-content bar.
 *
 * Images stay withheld until the user asks for this message, or has previously
 * trusted the sender — see `server/email/remote-content.js` for why they are
 * blocked in the first place.
 */
export function renderBodyWithRemoteControls(
  msg: EmailMessage,
  viewMode: EmailBodyViewMode,
  accountId: string,
  onStatus?: (state: "ok" | "err", message: string) => void,
): HTMLElement {
  const wrap = el("div", "email-thread-body-wrap");
  const sender = normalizeSender(msg.from);
  const hasHtml = Boolean(msg.bodyHtml?.trim());

  // Per-message state: whether remote images have been let through, and whether
  // the body is recoloured to fit a dark theme. Both feed one repaint.
  let loaded = imagesLoadedFor.has(msg.id) || (imageAllowlist?.includes(sender) ?? false);
  let dark = false;

  const bodyRegion = el("div", "email-thread-body-region");

  const paint = (): void => {
    bodyRegion.replaceChildren();

    const notice = el("div", "email-remote-notice");
    notice.hidden = true;
    const body = el("div", "email-thread-body");
    bodyRegion.append(notice, body);

    renderEmailBody(body, msg, {
      viewMode,
      loadRemoteImages: loaded,
      matchTheme: dark,
      inlineParts: { accountId, messageKey: msg.id },
      onRemoteContent: ({ blockedCount }) => {
        if (loaded || blockedCount === 0) return;

        const label = blockedCount === 1 ? "1 remote image" : `${blockedCount} remote images`;
        const text = el(
          "span",
          "email-remote-notice-text",
          `${label} blocked to keep your address and read time private.`,
        );

        const loadOnce = el("button", "", "Load images") as HTMLButtonElement;
        loadOnce.type = "button";
        loadOnce.addEventListener("click", () => {
          imagesLoadedFor.add(msg.id);
          loaded = true;
          paint();
        });

        notice.replaceChildren(text, loadOnce);

        if (sender) {
          const always = el("button", "", "Always from this sender") as HTMLButtonElement;
          always.type = "button";
          always.addEventListener("click", async () => {
            try {
              imageAllowlist = await allowImagesFromSender(sender);
              loaded = true;
              paint();
            } catch (err) {
              onStatus?.(
                "err",
                err instanceof Error ? err.message : "Could not update the image allowlist",
              );
            }
          });
          notice.appendChild(always);
        }

        notice.hidden = false;
      },
    });
  };

  // Mail is drawn for white, so Light is the default; "Match theme" recolours
  // text-dominant mail to fit dark via a safe smart-invert.
  if (hasHtml && viewMode === "html") {
    const controls = el("div", "email-body-controls");
    const toggle = el(
      "button",
      "email-body-theme-toggle",
      "Match theme",
    ) as HTMLButtonElement;
    toggle.type = "button";
    toggle.setAttribute("aria-pressed", "false");
    toggle.title = "Recolour this message to fit the dark theme";
    toggle.addEventListener("click", () => {
      dark = !dark;
      toggle.classList.toggle("is-active", dark);
      toggle.setAttribute("aria-pressed", dark ? "true" : "false");
      paint();
    });
    controls.appendChild(toggle);
    wrap.appendChild(controls);
  }

  wrap.appendChild(bodyRegion);
  paint();

  // Prime the allowlist once, then repaint if this sender turns out to be on it.
  if (imageAllowlist === null) {
    void fetchImageAllowlist()
      .then((senders) => {
        imageAllowlist = senders;
        if (!loaded && senders.includes(sender)) {
          loaded = true;
          paint();
        }
      })
      .catch(() => {
        imageAllowlist = [];
      });
  }

  return wrap;
}

export function formatWhen(iso?: string): string {
  if (!iso) return "—";

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return iso;

  const now = new Date();

  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleString(undefined, { month: "short", day: "numeric" });
}

/** Relative freshness for the list toolbar, e.g. "Updated 2m ago". */
function formatUpdatedAgo(ts: number): string {
  if (!ts) return "";
  const delta = Date.now() - ts;
  if (delta < 45_000) return "Updated just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hoursAgo = Math.floor(minutes / 60);
  if (hoursAgo < 24) return `Updated ${hoursAgo}h ago`;
  return `Updated ${Math.floor(hoursAgo / 24)}d ago`;
}

function urgencyClass(urgency?: string): string {
  if (urgency === "high") return "email-urgency-high";

  if (urgency === "low") return "email-urgency-low";

  return "email-urgency-normal";
}

/** Parse display name from a From header like "Name <email@x.com>". */

export function parseSender(from: string): { name: string; email: string } {
  const match = from.match(/^(.+?)\s*<([^>]+)>$/);

  if (match) {
    return {
      name: match[1].trim().replace(/^"|"$/g, ""),
      email: match[2].trim(),
    };
  }

  if (from.includes("@")) {
    return { name: from.split("@")[0], email: from };
  }

  return { name: from || "Unknown", email: "" };
}

/** Two-letter avatar initials from a sender string. */

export function senderInitials(from: string): string {
  const { name, email } = parseSender(from);

  const parts = name.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  const seed = name || email;

  return seed.slice(0, 2).toUpperCase();
}

/** Human label for common IMAP folder paths. */

export function folderLabel(path: string): string {
  const lower = path.toLowerCase();

  if (lower === "inbox") return "Inbox";

  if (lower.includes("sent")) return "Sent";

  if (lower.includes("draft")) return "Drafts";

  if (lower.includes("trash") || lower.includes("bin")) return "Trash";

  if (lower.includes("spam") || lower.includes("junk")) return "Spam";

  if (lower.includes("archive") || lower.includes("all mail")) return "Archive";

  if (lower.includes("starred") || lower.includes("flagged")) return "Starred";

  const leaf = path.split(/[/.]/).filter(Boolean).pop();

  return leaf ?? path;
}

/** Find a spam/junk folder path from the folder list. */

function findSpamFolder(folders: Array<{ path: string }>): string | undefined {
  return folders.find((row) => {
    const lower = row.path.toLowerCase();

    return lower.includes("spam") || lower.includes("junk");
  })?.path;
}

/**

 * Render Acme-style three-column mail client with standard mail affordances.

 */

export async function renderEmailLayout(
  mount: HTMLElement,
  options: EmailLayoutOptions,
): Promise<void> {
  mount.replaceChildren(el("p", "email-loading", "Loading mail…"));

  mount.className = "email-layout";

  let activeFolder = options.account.folders[0] ?? "INBOX";

  let folderRows: Array<{ path: string; name: string }> = [];

  let unreadByFolder: Record<string, number> = {};

  let messages: EmailMessage[] = [];

  let total = 0;

  let offset = 0;

  const limit = 50;

  let filter: "all" | "unread" | "flagged" | "snoozed" = "all";

  /**
   * Conversations are the default: a ten-message thread should occupy one row,
   * not ten. Per-message stays available for folders where the distinction
   * matters (Sent, or hunting one message in a long exchange).
   */
  let listMode: "threads" | "messages" = "threads";

  /** Conversation rollups, populated in threads mode. */
  let threads: EmailThreadSummary[] = [];

  let search = "";

  let selectedId: string | null = null;

  /** The open conversation, so its rollup row stays highlighted. */
  let selectedThreadId: string | null = null;

  let selectedThread: EmailMessage[] = [];

  let composeMode: ComposeMode | null = null;

  let bodyViewMode: EmailBodyViewMode = "html";

  const checked = new Set<string>();

  /**
   * Rows live here so an action can paint before the server answers. `messages`
   * above stays as the read view of the same data for the code that only reads.
   */
  const store = createMailStore({
    onError: (message) => options.onStatus?.("err", message),
  });

  /** Undo stack for `z` — the inverse of the last optimistic action. */
  const undoStack: Array<{ label: string; run: () => Promise<void> }> = [];

  /** Row the keyboard cursor is on, which is not always the open message. */
  let cursorIndex = 0;

  const shell = el("div", "email-layout-grid");

  const sidebar = el("nav", "email-nav");

  const listPane = el("section", "email-list-pane");

  const readerPane = el("section", "email-reader-pane");

  mount.replaceChildren(shell);

  shell.appendChild(sidebar);

  shell.appendChild(listPane);

  shell.appendChild(readerPane);

  const updateSelectionLayout = () => {
    shell.classList.toggle("has-selection", Boolean(selectedId));
  };

  let sidebarBuilt = false;

  let refreshSeq = 0;

  /** When the list last pulled from the server, for the "Updated" label. */
  let lastSyncedAt = Date.now();

  /** Single interval that keeps the relative "Updated" label current. */
  let updatedTimer = 0;

  /** Show a lightweight overlay while fetching a new folder's messages. */
  const setListLoading = (loading: boolean) => {
    listPane.classList.toggle("is-loading", loading);

    let overlay = listPane.querySelector(".email-list-loading");

    if (loading && !overlay) {
      overlay = el("div", "email-list-loading");

      overlay.setAttribute("aria-live", "polite");

      overlay.appendChild(el("p", "email-loading", "Loading messages…"));

      listPane.appendChild(overlay);
    } else if (!loading && overlay) {
      overlay.remove();
    }
  };

  /** Fetch folder paths and unread counts from the server (no DOM updates). */
  const fetchFolderMetadata = async (fetchRemoteFolders: boolean) => {
    if (fetchRemoteFolders) {
      try {
        folderRows = await fetchEmailFolders(options.account.id);
      } catch {
        if (folderRows.length === 0) {
          folderRows = options.account.folders.map((path) => ({
            path,
            name: folderLabel(path),
          }));
        }
      }
    }

    try {
      const summary = await fetchInboxSummary(options.account.id);

      unreadByFolder = summary.unreadByFolder ?? {};
    } catch {
      unreadByFolder = {};
    }
  };

  /** Highlight the active folder without rebuilding the sidebar. */
  const updateSidebarActiveFolder = () => {
    for (const btn of sidebar.querySelectorAll<HTMLButtonElement>(
      ".email-nav-item[data-folder]",
    )) {
      btn.classList.toggle("is-active", btn.dataset.folder === activeFolder);
    }
  };

  /** Sync unread badges on existing folder buttons. */
  const updateSidebarUnreadBadges = () => {
    for (const btn of sidebar.querySelectorAll<HTMLButtonElement>(
      ".email-nav-item[data-folder]",
    )) {
      const path = btn.dataset.folder ?? "";

      const unread = unreadByFolder[path];

      let badge = btn.querySelector(".email-nav-unread");

      if (unread && unread > 0) {
        if (!badge) {
          badge = el(
            "span",
            "email-nav-unread",
            String(unread > 99 ? "99+" : unread),
          );

          btn.appendChild(badge);
        } else {
          badge.textContent = String(unread > 99 ? "99+" : unread);
        }
      } else if (badge) {
        badge.remove();
      }
    }
  };

  /** Switch folders — update selection immediately, fetch messages in background. */
  const selectFolder = (path: string) => {
    if (path === activeFolder) return;

    activeFolder = path;

    offset = 0;

    selectedId = null;

    composeMode = null;

    updateSelectionLayout();

    updateSidebarActiveFolder();

    void refreshMessages({ showLoading: true });
  };

  /** Build sidebar once; subsequent refreshes only patch badges. */
  const renderSidebar = () => {
    if (!sidebarBuilt) {
      sidebar.replaceChildren();

      const composeBtn = el("button", "email-compose-btn") as HTMLButtonElement;

      composeBtn.type = "button";

      composeBtn.innerHTML = `${EMAIL_ICONS.compose}<span>Compose</span>`;

      composeBtn.setAttribute("aria-label", "Compose new message");

      composeBtn.addEventListener("click", () => {
        selectedId = null;

        composeMode = "new";

        updateSelectionLayout();

        void renderReader();
      });

      sidebar.appendChild(composeBtn);

      sidebar.appendChild(el("p", "email-nav-title", "Folders"));

      const list = el("div", "email-nav-list");

      sidebar.appendChild(list);

      sidebarBuilt = true;
    }

    const list = sidebar.querySelector(".email-nav-list");

    if (!list) return;

    list.replaceChildren();

    for (const folder of folderRows) {
      const btn = el("button", "email-nav-item") as HTMLButtonElement;

      btn.type = "button";

      btn.dataset.folder = folder.path;

      btn.appendChild(
        el("span", "email-nav-item-label", folderLabel(folder.path)),
      );

      const unread = unreadByFolder[folder.path];

      if (unread && unread > 0) {
        btn.appendChild(
          el(
            "span",
            "email-nav-unread",
            String(unread > 99 ? "99+" : unread),
          ),
        );
      }

      btn.classList.toggle("is-active", folder.path === activeFolder);

      btn.addEventListener("click", () => {
        selectFolder(folder.path);
      });

      list.appendChild(btn);
    }
  };

  /** Refresh sidebar badges; re-fetch remote folder list only when requested. */
  const refreshSidebar = async (fetchRemoteFolders = false) => {
    await fetchFolderMetadata(fetchRemoteFolders);

    if (!sidebarBuilt || fetchRemoteFolders) {
      renderSidebar();
    } else {
      updateSidebarUnreadBadges();

      updateSidebarActiveFolder();
    }
  };

  /**
   * The message ids the current selection stands for.
   *
   * Conversation rows are checked by thread id, so each one expands to every
   * message it contains before any bulk action runs.
   */
  const resolveCheckedMessageIds = async (): Promise<string[]> => {
    if (listMode === "messages") {
      return [...checked];
    }

    const expanded = await Promise.all(
      [...checked].map(async (threadId) => {
        try {
          const { messages: rows } = await fetchEmailThread(
            options.account.id,
            threadId,
          );
          return rows.map((row) => row.id);
        } catch {
          // A thread that cannot be read is skipped rather than failing the
          // whole batch; the others still get their action.
          return [];
        }
      }),
    );
    return expanded.flat();
  };

  const renderListToolbar = () => {
    const toolbar = el("div", "email-list-toolbar");

    const master = el("input", "email-list-master-cb") as HTMLInputElement;

    master.type = "checkbox";

    master.title = "Select all";

    master.setAttribute("aria-label", "Select all messages");

    master.addEventListener("change", () => {
      checked.clear();

      if (master.checked) {
        if (listMode === "threads") {
          for (const row of threads) checked.add(row.threadId);
        } else {
          for (const row of messages) checked.add(row.id);
        }
      }

      void renderList();
    });

    toolbar.appendChild(master);

    const actionGroup = el("div", "email-list-actions");

    const mkBulkIcon = (
      svg: string,
      label: string,
      action: "read" | "unread" | "flag" | "archive" | "delete",
    ) => {
      const btn = iconBtn(svg, label);

      btn.addEventListener("click", async () => {
        if (checked.size === 0) {
          options.onStatus?.("err", "Select messages first");

          return;
        }

        try {
          await bulkEmailAction({
            accountId: options.account.id,

            // In conversation mode `checked` holds thread ids, which the bulk
            // endpoint does not understand — expand them to their messages.
            ids: await resolveCheckedMessageIds(),

            action,
          });

          checked.clear();

          options.onStatus?.("ok", `${label} applied`);

          await refreshAll();
        } catch (err) {
          options.onStatus?.(
            "err",
            err instanceof Error ? err.message : "Bulk action failed",
          );
        }
      });

      actionGroup.appendChild(btn);
    };

    mkBulkIcon(EMAIL_ICONS.mailOpen, "Mark read", "read");

    mkBulkIcon(EMAIL_ICONS.mail, "Mark unread", "unread");

    mkBulkIcon(EMAIL_ICONS.star, "Flag", "flag");

    mkBulkIcon(EMAIL_ICONS.archive, "Archive", "archive");

    mkBulkIcon(EMAIL_ICONS.trash, "Delete", "delete");

    toolbar.appendChild(actionGroup);

    const syncBtn = iconBtn(EMAIL_ICONS.sync, "Sync folder");

    syncBtn.addEventListener("click", async () => {
      // No disabled-as-status: the chrome progress bar carries sync state.
      syncBtn.classList.add("is-syncing");
      options.onSyncActivity?.(true);

      try {
        const result = await syncEmailFolder(options.account.id, activeFolder);

        lastSyncedAt = Date.now();
        paintUpdated();

        options.onStatus?.("ok", `Synced ${result.synced} messages`);

        await refreshAll();
      } catch (err) {
        options.onStatus?.(
          "err",
          err instanceof Error ? err.message : "Sync failed",
        );
      } finally {
        syncBtn.classList.remove("is-syncing");
        options.onSyncActivity?.(false);
      }
    });

    toolbar.appendChild(syncBtn);

    // "Updated 2m ago" — the freshness readout that pairs with the sync bar.
    const updated = el("span", "email-list-updated");
    updated.setAttribute("role", "status");
    const paintUpdated = (): void => {
      if (!mount.isConnected) {
        window.clearInterval(updatedTimer);
        return;
      }
      updated.textContent = formatUpdatedAgo(lastSyncedAt);
      updated.title = `Last synced ${new Date(lastSyncedAt).toLocaleString()}`;
    };
    paintUpdated();
    window.clearInterval(updatedTimer);
    updatedTimer = window.setInterval(paintUpdated, 30_000);

    toolbar.appendChild(updated);

    const searchWrap = el("div", "email-list-search-wrap");

    searchWrap.innerHTML = EMAIL_ICONS.search;

    const searchInput = el(
      "input",
      "email-input email-list-search",
    ) as HTMLInputElement;

    searchInput.placeholder = "Search mail…";

    searchInput.value = search;

    searchInput.setAttribute("aria-label", "Search mail");

    let searchTimer: number | undefined;

    searchInput.addEventListener("input", () => {
      if (searchTimer) window.clearTimeout(searchTimer);

      searchTimer = window.setTimeout(() => {
        search = searchInput.value.trim();

        offset = 0;

        void refreshMessages({ showLoading: true });
      }, 300);
    });

    searchWrap.appendChild(searchInput);

    toolbar.appendChild(searchWrap);

    const filterSelect = el(
      "select",
      "email-select email-list-filter",
    ) as HTMLSelectElement;

    filterSelect.setAttribute("aria-label", "Filter messages");

    for (const value of ["all", "unread", "flagged", "snoozed"] as const) {
      const opt = el("option") as HTMLOptionElement;

      opt.value = value;

      opt.textContent =
        value === "all"
          ? "All mail"
          : value.charAt(0).toUpperCase() + value.slice(1);

      opt.selected = filter === value;

      filterSelect.appendChild(opt);
    }

    filterSelect.addEventListener("change", () => {
      filter = filterSelect.value as typeof filter;

      offset = 0;

      void refreshMessages({ showLoading: true });
    });

    toolbar.appendChild(filterSelect);

    // Conversation vs per-message. Selection is cleared on the way across:
    // the two modes key their checkboxes differently (thread id vs message id).
    const modeBtn = el(
      "button",
      "email-btn email-list-mode",
      listMode === "threads" ? "Conversations" : "Messages",
    ) as HTMLButtonElement;
    modeBtn.type = "button";
    modeBtn.title =
      listMode === "threads"
        ? "Showing conversations — switch to individual messages"
        : "Showing individual messages — switch to conversations";
    modeBtn.addEventListener("click", () => {
      listMode = listMode === "threads" ? "messages" : "threads";
      checked.clear();
      offset = 0;
      cursorIndex = 0;
      void refreshMessages({ showLoading: true });
    });
    toolbar.appendChild(modeBtn);

    const pager = el("div", "email-list-pager");

    const prevBtn = iconBtn(EMAIL_ICONS.chevronLeft, "Previous page");

    prevBtn.disabled = offset === 0;

    prevBtn.addEventListener("click", () => {
      offset = Math.max(0, offset - limit);

      void refreshMessages({ showLoading: true });
    });

    const pageLabel = el("span", "email-list-page", "");

    const nextBtn = iconBtn(EMAIL_ICONS.chevronRight, "Next page");

    nextBtn.disabled = offset + limit >= total;

    nextBtn.addEventListener("click", () => {
      if (offset + limit < total) {
        offset += limit;

        void refreshMessages({ showLoading: true });
      }
    });

    pager.appendChild(prevBtn);

    pager.appendChild(pageLabel);

    pager.appendChild(nextBtn);

    toolbar.appendChild(pager);

    return { toolbar, pageLabel, master };
  };

  const openCompose = (mode: ComposeMode) => {
    composeMode = mode;

    const composeMount = readerPane.querySelector(
      ".email-reader-compose-mount",
    );

    if (composeMount) {
      mountEmailCompose(composeMount as HTMLElement, {
        account: options.account,

        mode,

        threadId: selectedThread[0]?.threadId,

        messages: selectedThread,

        selectedMessage:
          messages.find((row) => row.id === selectedId) ?? selectedThread[0],

        onStatus: options.onStatus,

        onRefresh: () => {
          void refreshMessages({ showLoading: true });
        },

        onSent: () => {
          composeMode = null;

          void refreshAll();
        },
      });

      composeMount.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  const renderReader = async () => {
    readerPane.replaceChildren();

    updateSelectionLayout();

    if (composeMode === "new" && !selectedId) {
      const header = el("header", "email-reader-head");

      header.appendChild(el("h2", "email-reader-subject", "New message"));

      readerPane.appendChild(header);

      const composeMount = el("div", "email-reader-compose-mount");

      readerPane.appendChild(composeMount);

      mountEmailCompose(composeMount, {
        account: options.account,

        mode: "new",

        onStatus: options.onStatus,

        onSent: () => {
          composeMode = null;

          void refreshAll();
        },
      });

      return;
    }

    if (!selectedId) {
      const empty = el("div", "email-reader-empty");

      empty.appendChild(el("p", "email-empty-title", "No message selected"));

      empty.appendChild(
        el(
          "p",
          "email-empty-copy",
          "Choose a thread from the list, or compose a new message.",
        ),
      );

      readerPane.appendChild(empty);

      return;
    }

    const selected =
      messages.find((row) => row.id === selectedId) ??
      selectedThread.find((row) => row.id === selectedId) ??
      selectedThread[0];

    if (!selected) return;

    try {
      const { messages: thread } = await fetchEmailThread(
        options.account.id,
        selected.threadId,
      );

      selectedThread = thread;

      if (!selected.flags?.seen) {
        await setEmailMessageFlags(options.account.id, selected.id, {
          seen: true,
        });
      }

      const backBtn = iconBtn(
        EMAIL_ICONS.back,
        "Back to list",
        "email-reader-back",
      );

      backBtn.addEventListener("click", () => {
        selectedId = null;

        composeMode = null;

        void renderList();

        void renderReader();
      });

      readerPane.appendChild(backBtn);

      const header = el("header", "email-reader-head");

      header.appendChild(
        el("h2", "email-reader-subject", selected.subject || "(no subject)"),
      );

      const sender = parseSender(selected.from);

      const metaRow = el("div", "email-reader-meta-row");

      const avatar = el(
        "span",
        "email-sender-avatar",
        senderInitials(selected.from),
      );

      const metaText = el("div", "email-reader-meta-text");

      metaText.appendChild(el("p", "email-reader-from", sender.name));

      if (sender.email) {
        metaText.appendChild(el("p", "email-reader-email", sender.email));
      }

      metaText.appendChild(
        el("p", "email-reader-date", formatWhen(selected.date)),
      );

      metaRow.appendChild(avatar);

      metaRow.appendChild(metaText);

      header.appendChild(metaRow);

      const primaryActions = el("div", "email-reader-primary-actions");

      const replyBtn = iconBtn(
        EMAIL_ICONS.reply,
        "Reply",
        "email-btn email-btn-primary email-btn-icon",
      );

      replyBtn.appendChild(el("span", "email-btn-label", "Reply"));

      replyBtn.addEventListener("click", () => openCompose("reply"));

      const replyAllBtn = iconBtn(
        EMAIL_ICONS.replyAll,
        "Reply all",
        "email-btn email-btn-icon",
      );

      replyAllBtn.appendChild(el("span", "email-btn-label", "Reply all"));

      replyAllBtn.addEventListener("click", () => openCompose("replyAll"));

      const forwardBtn = iconBtn(
        EMAIL_ICONS.forward,
        "Forward",
        "email-btn email-btn-icon",
      );

      forwardBtn.appendChild(el("span", "email-btn-label", "Forward"));

      forwardBtn.addEventListener("click", () => openCompose("forward"));

      primaryActions.appendChild(replyBtn);

      primaryActions.appendChild(replyAllBtn);

      primaryActions.appendChild(forwardBtn);

      header.appendChild(primaryActions);

      const secondaryActions = el("div", "email-reader-actions");

      const flagBtn = iconBtn(
        selected.flags?.flagged ? EMAIL_ICONS.starFilled : EMAIL_ICONS.star,

        selected.flags?.flagged ? "Remove flag" : "Flag",
      );

      flagBtn.classList.toggle("is-active", Boolean(selected.flags?.flagged));

      flagBtn.addEventListener("click", async () => {
        await setEmailMessageFlags(options.account.id, selected.id, {
          flagged: !selected.flags?.flagged,
        });

        await refreshAll();
      });

      const archiveBtn = iconBtn(EMAIL_ICONS.archive, "Archive");

      archiveBtn.addEventListener("click", () =>
        void removeOpenMessage(selected, "archive", "Archived"),
      );

      const deleteBtn = iconBtn(EMAIL_ICONS.trash, "Delete");

      deleteBtn.classList.add("email-icon-btn--danger");

      // No confirm: trash is recoverable, so the reader closes at once and an
      // Undo toast is the safety net (see removeOpenMessage).
      deleteBtn.addEventListener("click", () =>
        void removeOpenMessage(selected, "delete", "Trashed"),
      );

      const moreWrap = el("div", "email-reader-more");

      const moreBtn = iconBtn(EMAIL_ICONS.more, "More actions");

      const menu = el("div", "email-reader-menu");

      menu.hidden = true;

      const mkMenuItem = (
        label: string,
        onClick: () => void | Promise<void>,
      ) => {
        const item = el(
          "button",
          "email-reader-menu-item",
          label,
        ) as HTMLButtonElement;

        item.type = "button";

        item.addEventListener("click", async () => {
          menu.hidden = true;

          await onClick();
        });

        menu.appendChild(item);
      };

      mkMenuItem("Mark unread", async () => {
        await setEmailMessageFlags(options.account.id, selected.id, {
          seen: false,
        });

        await refreshAll();
      });

      // Snooze presets cover what people actually pick; the message stays put
      // on the server and simply drops out of the list until it is due.
      const snoozePresets: Array<{ label: string; at: () => Date }> = [
        {
          label: "Later today",
          at: () => {
            const when = new Date();
            when.setHours(when.getHours() + 3, 0, 0, 0);
            return when;
          },
        },
        {
          label: "Tomorrow morning",
          at: () => {
            const when = new Date();
            when.setDate(when.getDate() + 1);
            when.setHours(9, 0, 0, 0);
            return when;
          },
        },
        {
          label: "Next week",
          at: () => {
            const when = new Date();
            when.setDate(when.getDate() + 7);
            when.setHours(9, 0, 0, 0);
            return when;
          },
        },
      ];

      if (selected.snoozeUntil) {
        mkMenuItem("Un-snooze", async () => {
          await snoozeEmailMessage(options.account.id, selected.id, "");
          options.onStatus?.("ok", "Un-snoozed");
          await refreshAll();
        });
      } else {
        menu.appendChild(el("p", "email-reader-menu-label", "Snooze until"));
        for (const preset of snoozePresets) {
          mkMenuItem(preset.label, async () => {
            const until = preset.at();
            try {
              await snoozeEmailMessage(
                options.account.id,
                selected.id,
                until.toISOString(),
              );
              options.onStatus?.("ok", `Snoozed until ${formatWhen(until.toISOString())}`);
              selectedId = null;
              await refreshAll();
            } catch (err) {
              options.onStatus?.(
                "err",
                err instanceof Error ? err.message : "Could not snooze",
              );
            }
          });
        }
      }

      const spamFolder = findSpamFolder(folderRows);

      if (spamFolder) {
        mkMenuItem("Mark as spam", async () => {
          await moveEmailMessage(options.account.id, selected.id, spamFolder);

          options.onStatus?.("ok", "Moved to spam");

          selectedId = null;

          await refreshAll();
        });
      }

      if (folderRows.length > 1) {
        const moveLabel = el("p", "email-reader-menu-label", "Move to folder");

        menu.appendChild(moveLabel);

        for (const folder of folderRows) {
          if (folder.path === activeFolder) continue;

          mkMenuItem(folderLabel(folder.path), async () => {
            await moveEmailMessage(
              options.account.id,
              selected.id,
              folder.path,
            );

            options.onStatus?.("ok", `Moved to ${folderLabel(folder.path)}`);

            selectedId = null;

            await refreshAll();
          });
        }
      }

      moreBtn.addEventListener("click", (event) => {
        event.stopPropagation();

        const willOpen = menu.hidden;

        menu.hidden = !willOpen;

        if (willOpen) {
          const closeMenu = () => {
            menu.hidden = true;

            document.removeEventListener("click", closeMenu);
          };

          window.setTimeout(
            () => document.addEventListener("click", closeMenu),
            0,
          );
        }
      });

      moreWrap.appendChild(moreBtn);

      moreWrap.appendChild(menu);

      secondaryActions.appendChild(flagBtn);

      secondaryActions.appendChild(archiveBtn);

      secondaryActions.appendChild(deleteBtn);

      secondaryActions.appendChild(moreWrap);

      header.appendChild(secondaryActions);

      readerPane.appendChild(header);

      // "Catch up" (§3.3) — a rolling summary atop genuinely long threads.
      // Requested async so opening the thread never waits on the LLM; the
      // server reuses its cached summary unless new mail changed the hash.
      if (thread.length > 3 || thread.some((msg) => (msg.bodyText?.length ?? 0) > 8000)) {
        const catchup = el("details", "email-reader-catchup");
        catchup.open = true;
        const catchupLabel = el("summary", "email-reader-catchup-label", "Catch up");
        catchup.appendChild(catchupLabel);

        // Busy state: opacity-pulse skeleton lines plus a cancel, until the
        // summary lands. Cancel abandons the wait rather than the request —
        // there is nothing to abort server-side — and drops the block.
        const busy = el("div", "email-reader-catchup-busy");
        busy.setAttribute("aria-busy", "true");
        busy.appendChild(el("span", "visually-hidden", "Summarizing thread…"));
        const skeleton = el("div", "email-skeleton email-reader-catchup-skeleton");
        skeleton.setAttribute("aria-hidden", "true");
        for (let line = 0; line < 3; line += 1) {
          skeleton.appendChild(el("span", "email-skeleton-line"));
        }
        const cancelBusy = el(
          "button",
          "email-reader-catchup-cancel",
          "Cancel",
        ) as HTMLButtonElement;
        cancelBusy.type = "button";
        busy.append(skeleton, cancelBusy);
        catchup.appendChild(busy);
        readerPane.appendChild(catchup);

        let cancelled = false;
        cancelBusy.addEventListener("click", () => {
          cancelled = true;
          catchup.remove();
        });

        void requestThreadSummary(options.account.id, selected.threadId)
          .then(({ eligible, summary }) => {
            if (cancelled) return;
            if (eligible && summary?.text) {
              catchup.replaceChildren(
                catchupLabel,
                el("p", "email-reader-catchup-text", summary.text),
              );
            } else {
              catchup.remove();
            }
          })
          .catch(() => {
            if (!cancelled) catchup.remove();
          });
      }

      const threadHasBodyToggle = thread.some((msg) =>
        emailBodySupportsViewToggle(msg),
      );

      if (threadHasBodyToggle) {
        const bodyViewBar = el("div", "email-body-view-bar");

        bodyViewBar.appendChild(
          el("span", "email-body-view-label", "Message view"),
        );

        const bodyViewToggle = el("div", "email-body-view-toggle");

        const mkBodyViewSegment = (
          mode: EmailBodyViewMode,
          label: string,
        ) => {
          const btn = el(
            "button",
            "email-body-view-segment",
            label,
          ) as HTMLButtonElement;

          btn.type = "button";
          btn.classList.toggle("is-active", bodyViewMode === mode);
          btn.setAttribute("aria-pressed", bodyViewMode === mode ? "true" : "false");

          btn.addEventListener("click", () => {
            if (bodyViewMode === mode) return;
            bodyViewMode = mode;
            void renderReader();
          });

          return btn;
        };

        bodyViewToggle.appendChild(mkBodyViewSegment("html", "Formatted"));
        bodyViewToggle.appendChild(mkBodyViewSegment("plain", "Plain text"));
        bodyViewBar.appendChild(bodyViewToggle);
        readerPane.appendChild(bodyViewBar);
      }

      const bodyStack = el("div", "email-reader-body-stack");

      for (const msg of thread) {
        const block = el("article", "email-reader-msg");

        block.appendChild(
          el(
            "p",
            "email-reader-msg-meta",
            `${msg.from} · ${formatWhen(msg.date)}`,
          ),
        );

        if (msg.triage?.summary) {
          const triage = el("div", "email-thread-triage");

          triage.appendChild(el("p", "", msg.triage.summary));

          block.appendChild(triage);
        }

        // Inline parts are rendered by the body iframe; listing them here would
        // offer the reader a signature logo as a download.
        const downloadable = (msg.attachments ?? []).filter((att) => !att.inline);
        if (downloadable.length > 0) {
          const attRow = el("div", "email-reader-attachments");
          attRow.appendChild(el("span", "email-reader-att-label", "Attachments"));

          // One shared preview slot below the chips: image/PDF attachments open
          // here; everything else downloads on click.
          const previewMount = el("div", "email-reader-att-preview");
          previewMount.hidden = true;

          let openIndex: number | null = null;
          let previewUrl: string | null = null;

          const clearPreview = (): void => {
            previewMount.hidden = true;
            previewMount.replaceChildren();
            openIndex = null;
            if (previewUrl) {
              URL.revokeObjectURL(previewUrl);
              previewUrl = null;
            }
            for (const other of attRow.querySelectorAll(".email-reader-att-chip")) {
              other.classList.remove("is-active");
              other.setAttribute("aria-expanded", "false");
            }
          };

          const downloadAttachment = async (index: number, chip: HTMLButtonElement): Promise<void> => {
            chip.disabled = true;
            try {
              const { blob, filename } = await downloadEmailAttachment(options.account.id, msg.id, index);
              saveBlobAs(blob, filename);
            } catch (err) {
              options.onStatus?.(
                "err",
                err instanceof Error ? err.message : "Could not download the attachment",
              );
            } finally {
              chip.disabled = false;
            }
          };

          const openPreview = async (
            att: { index: number; filename: string; contentType: string },
            kind: "image" | "pdf",
            chip: HTMLButtonElement,
          ): Promise<void> => {
            if (openIndex === att.index) {
              clearPreview();
              return;
            }
            clearPreview();
            openIndex = att.index;
            chip.classList.add("is-active");
            chip.setAttribute("aria-expanded", "true");
            previewMount.replaceChildren(el("p", "email-reader-att-loading", "Loading preview…"));
            previewMount.hidden = false;

            let blob: Blob;
            let filename: string;
            try {
              ({ blob, filename } = await downloadEmailAttachment(options.account.id, msg.id, att.index));
            } catch (err) {
              if (openIndex !== att.index) return;
              previewMount.replaceChildren(
                el("p", "email-empty is-err", err instanceof Error ? err.message : "Could not load the preview"),
              );
              return;
            }
            if (openIndex !== att.index) return; // superseded by another click

            previewUrl = URL.createObjectURL(blob);

            const bar = el("div", "email-reader-att-preview-bar");
            const dl = el("button", "email-btn", "Download") as HTMLButtonElement;
            dl.type = "button";
            dl.addEventListener("click", () => saveBlobAs(blob, filename));
            const close = el("button", "email-btn", "Close") as HTMLButtonElement;
            close.type = "button";
            close.addEventListener("click", clearPreview);
            bar.append(dl, close);

            const frame = el("div", "email-reader-att-frame");
            if (kind === "image") {
              const img = el("img", "email-reader-att-image") as HTMLImageElement;
              img.src = previewUrl;
              img.alt = att.filename;
              img.loading = "lazy";
              frame.appendChild(img);
            } else {
              const pdf = el("iframe", "email-reader-att-pdf") as HTMLIFrameElement;
              pdf.src = previewUrl;
              pdf.title = att.filename;
              frame.appendChild(pdf);
            }

            previewMount.replaceChildren(bar, frame);
          };

          for (const att of downloadable) {
            const chip = el(
              "button",
              "email-reader-att-chip",
              `${att.filename} (${formatBytes(att.size)})`,
            ) as HTMLButtonElement;
            chip.type = "button";
            const kind = previewKind(att.contentType, att.filename);
            if (kind) {
              chip.title = `Preview ${att.filename}`;
              chip.setAttribute("aria-expanded", "false");
              chip.addEventListener("click", () => void openPreview(att, kind, chip));
            } else {
              chip.title = `Download ${att.filename}`;
              chip.addEventListener("click", () => void downloadAttachment(att.index, chip));
            }
            attRow.appendChild(chip);
          }

          block.appendChild(attRow);
          block.appendChild(previewMount);
        }

        block.appendChild(
          renderBodyWithRemoteControls(
            msg,
            bodyViewMode,
            options.account.id,
            options.onStatus,
          ),
        );

        bodyStack.appendChild(block);
      }

      readerPane.appendChild(bodyStack);

      const composeMount = el("div", "email-reader-compose-mount");

      readerPane.appendChild(composeMount);

      if (composeMode) {
        mountEmailCompose(composeMount, {
          account: options.account,

          mode: composeMode,

          threadId: selected.threadId,

          messages: thread,

          selectedMessage: selected,

          onStatus: options.onStatus,

          onRefresh: () => {
            void refreshMessages({ showLoading: true });
          },

          onSent: () => {
            composeMode = null;

            void refreshAll();
          },
        });
      } else {
        composeMount.appendChild(
          el(
            "button",
            "email-compose-collapsed",
            "Click Reply above to write a response…",
          ) as HTMLButtonElement,
        );

        const collapsed = composeMount.querySelector(
          ".email-compose-collapsed",
        ) as HTMLButtonElement;

        collapsed.type = "button";

        collapsed.addEventListener("click", () => openCompose("reply"));
      }
    } catch (err) {
      readerPane.appendChild(
        el(
          "p",
          "email-empty is-err",
          err instanceof Error ? err.message : "Reader load failed",
        ),
      );
    }
  };

  const renderList = async () => {
    listPane.replaceChildren();

    const { toolbar, pageLabel, master } = renderListToolbar();

    listPane.appendChild(toolbar);

    const from = total === 0 ? 0 : offset + 1;

    const to = Math.min(offset + limit, total);

    pageLabel.textContent = `${from}–${to} of ${total}`;

    master.checked =
      listMode === "threads"
        ? threads.length > 0 && threads.every((row) => checked.has(row.threadId))
        : messages.length > 0 && messages.every((row) => checked.has(row.id));

    listPane.appendChild(virtualList.root);
    virtualList.setItems(listMode === "threads" ? threads : messages);
  };

  /**
   * Build one conversation row.
   *
   * Rendered on demand by the virtual list, so this runs for the visible
   * window only — which is what makes a 10k-message folder scroll.
   */
  const renderRow = (message: EmailMessage, index: number): HTMLElement => {
    const row = el("div", "email-list-row");

    row.classList.toggle("is-unread", !message.flags?.seen);
    row.classList.toggle("is-selected", message.id === selectedId);
    row.classList.toggle("is-flagged", Boolean(message.flags?.flagged));
    row.classList.toggle("is-cursor", index === cursorIndex);

    // Roving tabindex: one stop for the whole list, so Tab does not walk
    // through every conversation on the way to the reading pane.
    row.tabIndex = index === cursorIndex ? 0 : -1;
    // A list item, not an option: the row carries interactive controls (open,
    // star, select), which a listbox option may not. aria-current marks the
    // open message.
    row.setAttribute("role", "listitem");
    if (message.id === selectedId) row.setAttribute("aria-current", "true");

    const cb = el("input", "email-list-row-cb") as HTMLInputElement;
    cb.type = "checkbox";
    cb.checked = checked.has(message.id);
    cb.setAttribute("aria-label", `Select ${message.subject || "message"}`);
    cb.addEventListener("change", () => {
      if (cb.checked) checked.add(message.id);
      else checked.delete(message.id);
    });
    row.appendChild(cb);

    row.appendChild(el("span", "email-list-avatar", senderInitials(message.from)));

    const starBtn = iconBtn(
      message.flags?.flagged ? EMAIL_ICONS.starFilled : EMAIL_ICONS.star,
      message.flags?.flagged ? "Remove flag" : "Flag message",
      "email-list-star",
    );
    starBtn.classList.toggle("is-active", Boolean(message.flags?.flagged));
    starBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      void toggleStar(message.id);
    });
    row.appendChild(starBtn);

    const main = el("button", "email-list-row-main") as HTMLButtonElement;
    main.type = "button";
    main.tabIndex = -1;

    main.appendChild(el("span", "email-list-from", parseSender(message.from).name));
    main.appendChild(
      el("span", "email-list-subject", message.subject || "(no subject)"),
    );
    if (message.bodyPreview) {
      main.appendChild(el("span", "email-list-snippet", message.bodyPreview));
    }

    main.addEventListener("click", () => {
      cursorIndex = index;
      void openMessage(message.id);
    });
    row.appendChild(main);

    const meta = el("div", "email-list-row-meta");

    if (!message.flags?.seen) {
      meta.appendChild(el("span", "email-list-unread-dot", ""));
    }

    meta.appendChild(el("span", "email-list-date", formatWhen(message.date)));

    if (message.hasAttachments) {
      const attach = el("span", "email-list-attach");
      attach.innerHTML = EMAIL_ICONS.attach;
      attach.title = "Has attachments";
      meta.appendChild(attach);
    }

    if (message.snoozeUntil) {
      const snoozed = el("span", "email-list-snoozed", "snoozed");
      snoozed.title = `Hidden until ${formatWhen(message.snoozeUntil)}`;
      meta.appendChild(snoozed);
    }

    if (message.triage?.urgency && message.triage.urgency !== "normal") {
      const badge = el(
        "span",
        `email-urgency-badge ${urgencyClass(message.triage.urgency)}`,
      );
      badge.textContent = message.triage.urgency;
      meta.appendChild(badge);
    }

    row.appendChild(meta);
    return row;
  };

  /** Build one conversation-rollup row. */
  const renderThreadRow = (thread: EmailThreadSummary, index: number): HTMLElement => {
    const model = toConversationRow(thread);
    const row = el("div", "email-list-row email-list-row--thread");

    row.classList.toggle("is-unread", model.unread);
    row.classList.toggle("is-selected", thread.threadId === selectedThreadId);
    row.classList.toggle("is-flagged", model.flagged);
    row.classList.toggle("is-cursor", index === cursorIndex);

    row.tabIndex = index === cursorIndex ? 0 : -1;
    row.setAttribute("role", "listitem");
    if (thread.threadId === selectedThreadId) row.setAttribute("aria-current", "true");

    const cb = el("input", "email-list-row-cb") as HTMLInputElement;
    cb.type = "checkbox";
    cb.checked = checked.has(thread.threadId);
    cb.setAttribute("aria-label", `Select ${model.subject}`);
    cb.addEventListener("change", () => {
      if (cb.checked) checked.add(thread.threadId);
      else checked.delete(thread.threadId);
    });
    row.appendChild(cb);

    row.appendChild(
      el("span", "email-list-avatar", senderInitials(thread.participants?.[0] ?? "")),
    );

    const main = el("button", "email-list-row-main") as HTMLButtonElement;
    main.type = "button";
    main.tabIndex = -1;

    const senderLine = el("span", "email-list-from");
    senderLine.appendChild(document.createTextNode(model.participants));
    if (model.countLabel) {
      senderLine.appendChild(el("span", "email-list-count", model.countLabel));
    }
    main.appendChild(senderLine);

    main.appendChild(el("span", "email-list-subject", model.subject));
    if (model.snippet) {
      main.appendChild(el("span", "email-list-snippet", model.snippet));
    }

    main.addEventListener("click", () => {
      cursorIndex = index;
      void openThread(thread.threadId);
    });
    row.appendChild(main);

    const meta = el("div", "email-list-row-meta");
    if (model.unread) {
      meta.appendChild(el("span", "email-list-unread-dot", ""));
    }
    meta.appendChild(el("span", "email-list-date", formatWhen(model.date)));
    if (model.hasAttachments) {
      const attach = el("span", "email-list-attach");
      attach.innerHTML = EMAIL_ICONS.attach;
      attach.title = "Has attachments";
      meta.appendChild(attach);
    }
    row.appendChild(meta);

    return row;
  };

  const virtualList = createVirtualList<EmailMessage | EmailThreadSummary>({
    rowHeight: LIST_ROW_HEIGHT,
    renderRow: (item, index) =>
      listMode === "threads"
        ? renderThreadRow(item as EmailThreadSummary, index)
        : renderRow(item as EmailMessage, index),
    className: "email-list-rows",
    ariaLabel: "Messages",
    renderEmpty: () => {
      const empty = el("div", "email-list-empty");
      empty.appendChild(el("p", "email-empty-title", "No messages"));
      empty.appendChild(
        el("p", "email-empty-copy", "Sync this folder or try a different filter."),
      );
      return empty;
    },
  });

  // The store owns the rows; the list repaints whenever they change, which is
  // what lets an action show its result before the server has answered.
  store.subscribe((state) => {
    messages = state.messages;
    total = state.total;
    // In conversation mode the list is fed by `threads`; an optimistic message
    // edit still updates the store, it just does not repaint these rows.
    if (listMode === "messages") {
      virtualList.updateItems(state.messages);
    }
  });

  /** Open a conversation from a rollup row. */
  const openThread = async (threadId: string): Promise<void> => {
    selectedThreadId = threadId;
    bodyViewMode = "html";
    composeMode = null;

    // The reader is keyed by message; open the newest one in the thread.
    try {
      const { messages: rows } = await fetchEmailThread(options.account.id, threadId);
      // Seed the thread so the reader can resolve the open message in
      // conversation mode, where the per-message store stays empty. Without
      // this the reading pane opens blank on every conversation click.
      selectedThread = rows;
      selectedId = rows[rows.length - 1]?.id ?? null;
    } catch (err) {
      options.onStatus?.(
        "err",
        err instanceof Error ? err.message : "Could not open the conversation",
      );
      return;
    }

    updateSelectionLayout();
    virtualList.refresh();
    await renderReader();
  };

  /** Open a message, painting the thread before the mark-seen round trip. */
  const openMessage = async (id: string): Promise<void> => {
    selectedId = id;
    bodyViewMode = "html";
    composeMode = null;
    updateSelectionLayout();
    virtualList.refresh();
    await renderReader();
  };

  const toggleStar = async (id: string): Promise<void> => {
    const message = store.get(id);
    if (!message) return;
    const next = !message.flags?.flagged;

    await store.mutate(id, { flags: { ...message.flags, flagged: next } as EmailMessage["flags"] }, () =>
      setEmailMessageFlags(options.account.id, id, { flagged: next }),
    );

    pushUndo(next ? "Starred" : "Unstarred", async () => {
      await store.mutate(
        id,
        { flags: { ...message.flags, flagged: !next } as EmailMessage["flags"] },
        () => setEmailMessageFlags(options.account.id, id, { flagged: !next }),
      );
    });
  };

  /** Remember how to reverse the last action, for `z`. */
  const pushUndo = (label: string, run: () => Promise<void>): void => {
    undoStack.push({ label, run });
    // One level deep is what people actually reach for, and a longer stack
    // would start replaying actions against rows that have since changed.
    if (undoStack.length > 1) undoStack.shift();
  };

  const loadMessages = async () => {
    if (listMode === "threads") {
      const result = await fetchEmailThreads(options.account.id, {
        folder: activeFolder,
        offset,
        limit,
        filter: filter === "all" ? undefined : filter,
        query: search || undefined,
      });

      threads = result.threads;
      total = result.total;
      cursorIndex = Math.min(cursorIndex, Math.max(0, threads.length - 1));
      return;
    }

    const result = await fetchEmailMessagesExtended(options.account.id, {
      folder: activeFolder,

      offset,

      limit,

      search,

      filter,
    });

    // The store is authoritative from here on; `messages`/`total` are kept in
    // step by its subscriber above.
    store.replace(result.messages, result.total);

    cursorIndex = Math.min(cursorIndex, Math.max(0, result.messages.length - 1));
  };

  const refreshMessages = async (opts?: { showLoading?: boolean }) => {
    const seq = ++refreshSeq;

    if (opts?.showLoading) setListLoading(true);

    try {
      await loadMessages();

      if (seq !== refreshSeq) return;

      await renderList();

      if (selectedId || options.initialThreadId) {
        if (options.initialThreadId && !selectedId) {
          const match = messages.find(
            (row) => row.threadId === options.initialThreadId,
          );

          if (match) selectedId = match.id;
        }

        await renderReader();
      } else if (composeMode === "new") {
        await renderReader();
      } else {
        readerPane.replaceChildren();

        updateSelectionLayout();

        const empty = el("div", "email-reader-empty");

        empty.appendChild(el("p", "email-empty-title", "No message selected"));

        empty.appendChild(
          el(
            "p",
            "email-empty-copy",
            "Choose a thread from the list, or compose a new message.",
          ),
        );

        readerPane.appendChild(empty);
      }
    } catch (err) {
      if (seq !== refreshSeq) return;

      listPane.replaceChildren(
        el(
          "p",
          "email-empty is-err",
          err instanceof Error ? err.message : "List load failed",
        ),
      );
    } finally {
      if (seq === refreshSeq && opts?.showLoading) setListLoading(false);
    }
  };

  const refreshAll = async (fetchRemoteFolders = false) => {
    await Promise.all([
      refreshMessages(),
      refreshSidebar(fetchRemoteFolders),
    ]);
  };

  /**
   * Archive or trash the open message with no confirm.
   *
   * Both are recoverable (Trash is a folder; Archive is a move), so the reader
   * closes at once — the message feels gone — and an Undo toast, plus `z`, is
   * the only safety net. A failure restores the reader so nothing is lost.
   */
  const removeOpenMessage = async (
    message: EmailMessage,
    action: "archive" | "delete",
    label: string,
  ): Promise<void> => {
    const subject = message.subject || "message";
    const folder = message.folder;

    if (selectedId === message.id) {
      selectedId = null;
      composeMode = null;
      void renderList();
      void renderReader();
    }

    const undo = async () => {
      await moveEmailMessage(options.account.id, message.id, folder);
      await refreshAll();
    };

    try {
      await (action === "archive"
        ? archiveEmailMessage(options.account.id, message.id)
        : deleteEmailMessage(options.account.id, message.id));
      pushUndo(label, undo);
      showActionUndoToast(`${label} "${subject}"`, {
        onUndo: undo,
        onStatus: options.onStatus,
      });
      await refreshAll();
    } catch (err) {
      options.onStatus?.(
        "err",
        err instanceof Error
          ? err.message
          : `Couldn't ${action === "archive" ? "archive" : "move to Trash"} — nothing changed`,
      );
      selectedId = message.id;
      await refreshAll();
      await renderReader();
    }
  };

  // ---------------------------------------------------------------------
  // Keyboard model
  // ---------------------------------------------------------------------

  /** How many rows the list is currently showing, whichever mode it is in. */
  const rowCount = (): number =>
    listMode === "threads" ? threads.length : messages.length;

  /**
   * Message ids the cursor row stands for.
   *
   * In conversation mode one row is a whole thread, so an action has to apply
   * to every message in it — archiving "the row" while leaving four of its five
   * messages in the inbox would be worse than not offering the shortcut.
   */
  const cursorMessageIds = async (): Promise<string[]> => {
    if (listMode === "messages") {
      const message = messages[cursorIndex];
      return message ? [message.id] : [];
    }

    const thread = threads[cursorIndex];
    if (!thread) return [];
    try {
      const { messages: rows } = await fetchEmailThread(
        options.account.id,
        thread.threadId,
      );
      return rows.map((row) => row.id);
    } catch {
      return [];
    }
  };

  /** Move the cursor and keep it in view without opening anything. */
  const moveCursor = (delta: number): void => {
    if (rowCount() === 0) return;
    cursorIndex = Math.min(rowCount() - 1, Math.max(0, cursorIndex + delta));
    virtualList.refresh();
    virtualList.scrollToIndex(cursorIndex);
    // Follow the cursor with focus so a screen reader announces the row.
    const row = virtualList.root.querySelector<HTMLElement>(".email-list-row.is-cursor");
    row?.focus();
  };

  const cursorMessage = (): EmailMessage | undefined =>
    listMode === "messages" ? messages[cursorIndex] : undefined;

  /** Label for the row under the cursor, in either mode. */
  const cursorLabel = (): string =>
    (listMode === "threads"
      ? threads[cursorIndex]?.subject
      : messages[cursorIndex]?.subject) || "message";

  /**
   * Apply a removing action (archive/trash) to the cursor row.
   *
   * In message mode this is one optimistic removal; in conversation mode the
   * whole thread goes through the bulk endpoint, then the list reloads —
   * a rollup row has no single id for the store to take back.
   */
  const removeCursor = async (
    action: "archive" | "delete",
    label: string,
  ): Promise<void> => {
    const subject = cursorLabel();

    if (listMode === "messages") {
      const message = cursorMessage();
      if (!message) return;
      const folder = message.folder;

      const ok = await store.remove(message.id, () =>
        action === "archive"
          ? archiveEmailMessage(options.account.id, message.id)
          : deleteEmailMessage(options.account.id, message.id),
      );
      if (!ok) return;

      const undo = async () => {
        await moveEmailMessage(options.account.id, message.id, folder);
        await refreshMessages();
      };
      pushUndo(label, undo);
      // The toast is the feedback and the way back; `z` mirrors it.
      showActionUndoToast(`${label} "${subject}"`, {
        onUndo: undo,
        onStatus: options.onStatus,
      });
      return;
    }

    const ids = await cursorMessageIds();
    if (ids.length === 0) return;

    // Remember where each message was so the undo can put it back.
    const origins = ids.map((id) => ({
      id,
      folder: store.get(id)?.folder ?? activeFolder,
    }));

    try {
      await bulkEmailAction({ accountId: options.account.id, ids, action });
    } catch (err) {
      options.onStatus?.(
        "err",
        err instanceof Error ? err.message : `${label} failed`,
      );
      return;
    }

    const undo = async () => {
      for (const origin of origins) {
        await moveEmailMessage(options.account.id, origin.id, origin.folder);
      }
      await refreshMessages();
    };
    pushUndo(label, undo);
    showActionUndoToast(
      `${label} "${subject}" (${ids.length} message${ids.length === 1 ? "" : "s"})`,
      { onUndo: undo, onStatus: options.onStatus },
    );
    await refreshMessages();
  };

  const archiveCursor = (): Promise<void> => removeCursor("archive", "Archived");

  // Deleting means "moved to trash", which is recoverable — so no confirm
  // dialog, just a way back.
  const trashCursor = (): Promise<void> => removeCursor("delete", "Trashed");

  const composeIn = (mode: ComposeMode): void => {
    composeMode = mode;
    if (mode !== "new" && !selectedId) {
      // Nothing is open yet, so open the cursor row first and compose into it.
      if (listMode === "threads") {
        const thread = threads[cursorIndex];
        if (!thread) return;
        void openThread(thread.threadId).then(() => {
          composeMode = mode;
          void renderReader();
        });
        return;
      }

      const message = cursorMessage();
      if (!message) return;
      void openMessage(message.id).then(() => {
        composeMode = mode;
        void renderReader();
      });
      return;
    }
    void renderReader();
  };

  const teardownShortcuts = bindMailShortcuts(mount, {
    next: () => moveCursor(1),
    previous: () => moveCursor(-1),
    open: () => {
      if (listMode === "threads") {
        const thread = threads[cursorIndex];
        if (thread) void openThread(thread.threadId);
        return;
      }
      const message = cursorMessage();
      if (message) void openMessage(message.id);
    },
    back: () => {
      selectedId = null;
      selectedThreadId = null;
      composeMode = null;
      updateSelectionLayout();
      void renderReader();
      virtualList.refresh();
    },
    archive: () => void archiveCursor(),
    trash: () => void trashCursor(),
    star: () => {
      if (listMode === "threads") {
        // Star the whole conversation, matching what the row represents.
        void (async () => {
          const thread = threads[cursorIndex];
          const ids = await cursorMessageIds();
          if (!thread || ids.length === 0) return;
          try {
            await bulkEmailAction({
              accountId: options.account.id,
              ids,
              action: "flag",
            });
            await refreshMessages();
          } catch (err) {
            options.onStatus?.(
              "err",
              err instanceof Error ? err.message : "Could not flag the conversation",
            );
          }
        })();
        return;
      }
      const message = cursorMessage();
      if (message) void toggleStar(message.id);
    },
    select: () => {
      // Checkboxes are keyed by thread id in conversation mode and message id
      // otherwise; the bulk actions read the same set, so they must agree.
      const id =
        listMode === "threads"
          ? threads[cursorIndex]?.threadId
          : messages[cursorIndex]?.id;
      if (!id) return;
      if (checked.has(id)) checked.delete(id);
      else checked.add(id);
      virtualList.refresh();
    },
    reply: () => composeIn("reply"),
    replyAll: () => composeIn("replyAll"),
    forward: () => composeIn("forward"),
    compose: () => composeIn("new"),
    search: () => {
      listPane.querySelector<HTMLInputElement>(".email-list-search")?.focus();
    },
    undo: () => {
      const entry = undoStack.pop();
      if (!entry) {
        options.onStatus?.("ok", "Nothing to undo");
        return;
      }
      void entry.run().then(
        () => options.onStatus?.("ok", `Undid ${entry.label.toLowerCase()}`),
        (err: unknown) =>
          options.onStatus?.(
            "err",
            err instanceof Error ? err.message : "Undo failed",
          ),
      );
    },
    help: () => showShortcutCheatSheet(mount),
  });

  // The shell is the shortcut root, so it must be able to hold focus.
  mount.tabIndex = -1;
  void teardownShortcuts;

  // Bootstrap sidebar from cached account folders so panes are not empty while fetching.
  folderRows = options.account.folders.map((path) => ({
    path,
    name: folderLabel(path),
  }));

  renderSidebar();

  setListLoading(true);

  await Promise.all([
    refreshMessages({ showLoading: true }),
    refreshSidebar(true),
  ]);
}
