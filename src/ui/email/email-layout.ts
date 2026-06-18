/**

 * Three-pane mail layout — folders, message list, reading pane.

 */

import type { EmailAccount, EmailMessage } from "../../email/client";

import { syncEmailFolder, fetchEmailThread } from "../../email/client";

import {
  archiveEmailMessage,
  bulkEmailAction,
  deleteEmailMessage,
  fetchEmailFolders,
  fetchEmailMessagesExtended,
  fetchInboxSummary,
  moveEmailMessage,
  setEmailMessageFlags,
} from "../../email/client-ext";

import { mountEmailCompose, type ComposeMode } from "./email-compose";

import {
  emailBodySupportsViewToggle,
  renderEmailBody,
  type EmailBodyViewMode,
} from "./email-body";

import { EMAIL_ICONS } from "./email-icons";

export interface EmailLayoutOptions {
  account: EmailAccount;

  initialThreadId?: string;

  onStatus?: (state: "ok" | "err", message: string) => void;
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

function formatWhen(iso?: string): string {
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

function urgencyClass(urgency?: string): string {
  if (urgency === "high") return "email-urgency-high";

  if (urgency === "low") return "email-urgency-low";

  return "email-urgency-normal";
}

/** Parse display name from a From header like "Name <email@x.com>". */

function parseSender(from: string): { name: string; email: string } {
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

function senderInitials(from: string): string {
  const { name, email } = parseSender(from);

  const parts = name.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  const seed = name || email;

  return seed.slice(0, 2).toUpperCase();
}

/** Human label for common IMAP folder paths. */

function folderLabel(path: string): string {
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

  let filter: "all" | "unread" | "flagged" = "all";

  let search = "";

  let selectedId: string | null = null;

  let selectedThread: EmailMessage[] = [];

  let composeMode: ComposeMode | null = null;

  let bodyViewMode: EmailBodyViewMode = "html";

  const checked = new Set<string>();

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

  const renderListToolbar = () => {
    const toolbar = el("div", "email-list-toolbar");

    const master = el("input", "email-list-master-cb") as HTMLInputElement;

    master.type = "checkbox";

    master.title = "Select all";

    master.setAttribute("aria-label", "Select all messages");

    master.addEventListener("change", () => {
      checked.clear();

      if (master.checked) {
        for (const row of messages) checked.add(row.id);
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

            ids: [...checked],

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
      syncBtn.disabled = true;

      try {
        const result = await syncEmailFolder(options.account.id, activeFolder);

        options.onStatus?.("ok", `Synced ${result.synced} messages`);

        await refreshAll();
      } catch (err) {
        options.onStatus?.(
          "err",
          err instanceof Error ? err.message : "Sync failed",
        );
      } finally {
        syncBtn.disabled = false;
      }
    });

    toolbar.appendChild(syncBtn);

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

    for (const value of ["all", "unread", "flagged"] as const) {
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
      messages.find((row) => row.id === selectedId) ?? selectedThread[0];

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

      archiveBtn.addEventListener("click", async () => {
        await archiveEmailMessage(options.account.id, selected.id);

        options.onStatus?.("ok", "Archived");

        selectedId = null;

        await refreshAll();
      });

      const deleteBtn = iconBtn(EMAIL_ICONS.trash, "Delete");

      deleteBtn.classList.add("email-icon-btn--danger");

      deleteBtn.addEventListener("click", async () => {
        if (!window.confirm("Move to trash?")) return;

        await deleteEmailMessage(options.account.id, selected.id);

        selectedId = null;

        await refreshAll();
      });

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

        if (msg.attachments && msg.attachments.length > 0) {
          const attRow = el("div", "email-reader-attachments");

          attRow.appendChild(
            el("span", "email-reader-att-label", "Attachments"),
          );

          for (const att of msg.attachments) {
            const chip = el(
              "span",
              "email-reader-att-chip",
              `${att.filename} (${Math.round(att.size / 1024)} KB)`,
            );

            attRow.appendChild(chip);
          }

          block.appendChild(attRow);
        }

        const body = el("div", "email-thread-body");

        renderEmailBody(body, msg, bodyViewMode);

        block.appendChild(body);

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
      messages.length > 0 && messages.every((row) => checked.has(row.id));

    const list = el("div", "email-list-rows");

    if (messages.length === 0) {
      const empty = el("div", "email-list-empty");

      empty.appendChild(el("p", "email-empty-title", "No messages"));

      empty.appendChild(
        el(
          "p",
          "email-empty-copy",
          "Sync this folder or try a different filter.",
        ),
      );

      list.appendChild(empty);
    }

    for (const message of messages) {
      const row = el("div", "email-list-row");

      row.classList.toggle("is-unread", !message.flags?.seen);

      row.classList.toggle("is-selected", message.id === selectedId);

      row.classList.toggle("is-flagged", Boolean(message.flags?.flagged));

      const cb = el("input", "email-list-row-cb") as HTMLInputElement;

      cb.type = "checkbox";

      cb.checked = checked.has(message.id);

      cb.setAttribute("aria-label", `Select ${message.subject || "message"}`);

      cb.addEventListener("change", () => {
        if (cb.checked) checked.add(message.id);
        else checked.delete(message.id);
      });

      row.appendChild(cb);

      const avatar = el(
        "span",
        "email-list-avatar",
        senderInitials(message.from),
      );

      row.appendChild(avatar);

      const starBtn = iconBtn(
        message.flags?.flagged ? EMAIL_ICONS.starFilled : EMAIL_ICONS.star,

        message.flags?.flagged ? "Remove flag" : "Flag message",

        "email-list-star",
      );

      starBtn.classList.toggle("is-active", Boolean(message.flags?.flagged));

      starBtn.addEventListener("click", async (event) => {
        event.stopPropagation();

        await setEmailMessageFlags(options.account.id, message.id, {
          flagged: !message.flags?.flagged,
        });

        await refreshAll();
      });

      row.appendChild(starBtn);

      const main = el("button", "email-list-row-main") as HTMLButtonElement;

      main.type = "button";

      const fromLine = el(
        "span",
        "email-list-from",
        parseSender(message.from).name,
      );

      const subjectLine = el(
        "span",
        "email-list-subject",
        message.subject || "(no subject)",
      );

      main.appendChild(fromLine);

      main.appendChild(subjectLine);

      if (message.bodyPreview) {
        main.appendChild(el("span", "email-list-snippet", message.bodyPreview));
      }

      main.addEventListener("click", async () => {
        selectedId = message.id;

        bodyViewMode = "html";

        composeMode = null;

        updateSelectionLayout();

        await renderList();

        await renderReader();
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

      if (message.triage?.urgency && message.triage.urgency !== "normal") {
        const badge = el(
          "span",
          `email-urgency-badge ${urgencyClass(message.triage.urgency)}`,
        );

        badge.textContent = message.triage.urgency;

        meta.appendChild(badge);
      }

      row.appendChild(meta);

      list.appendChild(row);
    }

    listPane.appendChild(list);
  };

  const loadMessages = async () => {
    const result = await fetchEmailMessagesExtended(options.account.id, {
      folder: activeFolder,

      offset,

      limit,

      search,

      filter,
    });

    messages = result.messages;

    total = result.total;
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
