/**
 * Inline compose block for the reading pane footer.
 */

import { appConfirm } from "../app-dialog";
import type { EmailAccount, EmailMessage } from "../../email/client";
import {
  draftEmailReply,
  improveEmailText,
  sendEmailMessage,
} from "../../email/client";
import {
  regenerateReplyVariants,
  suggestEmailSubject,
} from "../../email/client-ext";
import {
  buildReferencesChain,
  collectAccountEmails,
  extractEmailAddress,
  resolveReplyTarget,
} from "../../email/reply-headers";
import { createComposeBodyEditor } from "./email-compose-editor";
import { showSendUndoToast } from "./email-undo-toast";
import { createRecipientField } from "./email-recipient-field";
import {
  createAttachmentTray,
  enableAttachmentDrop,
} from "./email-attachment-tray";
import { deleteEmailDraft, saveEmailDraft } from "../../email/client-drafts";

/** How long after the last keystroke a draft is persisted. */
const DRAFT_AUTOSAVE_MS = 1200;

/** Regexes that suggest the writer meant to attach something. */
const ATTACHMENT_INTENT = /\b(attach(ed|ing|ment)?s?|enclosed|see the (file|doc|deck))\b/i;

export type ComposeMode = "reply" | "replyAll" | "forward" | "new";

export interface EmailComposeOptions {
  account: EmailAccount;
  mode: ComposeMode;
  threadId?: string;
  messages?: EmailMessage[];
  selectedMessage?: EmailMessage;
  onStatus?: (state: "ok" | "err", message: string) => void;
  onSent?: () => void;
  onRefresh?: () => void;
  /** Prefilled fields, used to restore a composer after an undone send. */
  draft?: {
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body?: string;
  };
  /** Existing stored draft to resume, so autosave updates it in place. */
  draftId?: string;
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

function extractEmail(header: string): string {
  return extractEmailAddress(header);
}

function collectRecipients(
  messages: EmailMessage[],
  accountEmail: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const self = accountEmail.toLowerCase();

  for (const msg of messages) {
    const from = extractEmail(msg.from).toLowerCase();
    if (from && from !== self && !seen.has(from)) {
      seen.add(from);
      out.push(extractEmail(msg.from));
    }

    for (const to of msg.to ?? []) {
      const addr = extractEmail(to).toLowerCase();
      if (addr && addr !== self && !seen.has(addr)) {
        seen.add(addr);
        out.push(extractEmail(to));
      }
    }
  }

  return out;
}

function buildThreadContext(messages: EmailMessage[] | undefined): string {
  if (!messages?.length) return "";
  return messages
    .slice(-4)
    .map(
      (row) =>
        `${row.from}: ${(row.bodyText ?? row.bodyPreview ?? "").slice(0, 400)}`,
    )
    .join("\n\n");
}

/** Ghost action in the compose header (matches dashboard reprompt weight). */
function headAction(label: string, title: string): HTMLButtonElement {
  const button = el(
    "button",
    "email-compose-head-btn",
    label,
  ) as HTMLButtonElement;
  button.type = "button";
  button.title = title;
  return button;
}

export function mountEmailCompose(
  mount: HTMLElement,
  options: EmailComposeOptions,
): void {
  mount.replaceChildren();
  mount.className = "email-compose is-open";

  const canAutoGenerate =
    Boolean(options.threadId) &&
    (options.mode === "reply" || options.mode === "replyAll");

  const head = el("div", "email-compose-head");
  head.appendChild(el("p", "email-compose-title", composeTitle(options.mode)));

  const headActions = el("div", "email-compose-head-actions");
  const draftBtn = headAction("Draft", "Write a reply from the thread");
  const redraftBtn = headAction("Redraft", "Rewrite with optional instructions");
  redraftBtn.hidden = true;
  const headStatus = el("span", "email-compose-head-status");
  headStatus.setAttribute("aria-live", "polite");

  if (canAutoGenerate) {
    headActions.appendChild(draftBtn);
    headActions.appendChild(redraftBtn);
    headActions.appendChild(headStatus);
    head.appendChild(headActions);
  }
  mount.appendChild(head);

  const repromptRow = el("div", "email-compose-reprompt");
  repromptRow.hidden = true;
  const repromptInput = el("input", "email-input email-compose-reprompt-input") as HTMLInputElement;
  repromptInput.placeholder = "Optional instructions for the draft…";
  repromptInput.autocomplete = "off";
  const repromptApply = el(
    "button",
    "email-btn email-compose-reprompt-apply",
    "Apply",
  ) as HTMLButtonElement;
  repromptApply.type = "button";
  repromptApply.title = "Apply instructions";
  repromptRow.appendChild(repromptInput);
  repromptRow.appendChild(repromptApply);
  if (canAutoGenerate) {
    mount.appendChild(repromptRow);
  }

  const fieldRow = (
    label: string,
    input: HTMLElement,
    rowOptions?: { labelledBy?: string },
  ) => {
    const isNativeControl =
      input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement;
    const row = el(
      isNativeControl ? "label" : "div",
      "email-compose-field",
    );

    const labelEl = el("span", "email-compose-field-label", label);
    if (rowOptions?.labelledBy) {
      labelEl.id = rowOptions.labelledBy;
      input.setAttribute("aria-labelledby", rowOptions.labelledBy);
    }

    row.appendChild(labelEl);
    row.appendChild(input);
    mount.appendChild(row);
  };

  const toField = createRecipientField({
    accountId: options.account.id,
    placeholder: "Recipients",
    name: "to",
  });
  const ccField = createRecipientField({
    accountId: options.account.id,
    placeholder: "Cc (optional)",
    name: "cc",
  });
  const bccField = createRecipientField({
    accountId: options.account.id,
    placeholder: "Bcc (optional)",
    name: "bcc",
  });
  const toInput = toField.input;
  const ccInput = ccField.input;
  const bccInput = bccField.input;

  const subjectInput = el("input", "email-input") as HTMLInputElement;
  subjectInput.placeholder = "Subject";
  subjectInput.name = "subject";

  const threadContext = buildThreadContext(options.messages);

  const bodyEditor = createComposeBodyEditor({
    onImprove: async (selection, mode, instructions) => {
      const result = await improveEmailText({
        text: selection,
        fullBody: bodyEditor.getPlainText(),
        threadContext: threadContext || undefined,
        mode,
        instructions,
      });
      return result.text;
    },
  });

  fieldRow("To", toField.root, { labelledBy: "email-compose-to-label" });

  // Cc/Bcc stay collapsed until asked for — most messages need neither, and
  // three always-present recipient rows push the body off a short pane.
  const ccRow = el("div", "email-compose-optional-recipients");
  const showCcBtn = el("button", "email-compose-head-btn", "Cc") as HTMLButtonElement;
  showCcBtn.type = "button";
  showCcBtn.title = "Add a Cc field";
  const showBccBtn = el("button", "email-compose-head-btn", "Bcc") as HTMLButtonElement;
  showBccBtn.type = "button";
  showBccBtn.title = "Add a Bcc field";
  ccRow.append(showCcBtn, showBccBtn);
  mount.appendChild(ccRow);

  const ccWrap = el("div", "email-compose-field");
  ccWrap.append(el("span", "email-compose-field-label", "Cc"), ccField.root);
  ccWrap.hidden = true;
  mount.appendChild(ccWrap);

  const bccWrap = el("div", "email-compose-field");
  bccWrap.append(el("span", "email-compose-field-label", "Bcc"), bccField.root);
  bccWrap.hidden = true;
  mount.appendChild(bccWrap);

  const revealCc = (): void => {
    ccWrap.hidden = false;
    showCcBtn.hidden = true;
  };
  const revealBcc = (): void => {
    bccWrap.hidden = false;
    showBccBtn.hidden = true;
  };
  showCcBtn.addEventListener("click", () => {
    revealCc();
    ccInput.focus();
  });
  showBccBtn.addEventListener("click", () => {
    revealBcc();
    bccInput.focus();
  });

  // Reply-all and forward normally carry a Cc, so open it up front.
  if (options.mode === "replyAll" || options.mode === "forward") {
    revealCc();
  }

  fieldRow("Subject", subjectInput);

  // Subject suggestion (§3.6) — offered only for new mail once the body has
  // enough substance to name, and only while the subject is still empty.
  if (options.mode === "new") {
    const suggestRow = el("div", "email-compose-subject-suggest");
    suggestRow.hidden = true;
    const suggestBtn = el(
      "button",
      "email-compose-suggest-btn",
      "Suggest subject",
    ) as HTMLButtonElement;
    suggestBtn.type = "button";
    suggestBtn.title = "Let AI name this message from the draft body";
    suggestRow.appendChild(suggestBtn);
    mount.appendChild(suggestRow);

    const refreshSuggestVisibility = (): void => {
      const words = bodyEditor.getPlainText().split(/\s+/).filter(Boolean).length;
      suggestRow.hidden = subjectInput.value.trim().length > 0 || words < 20;
    };
    bodyEditor.root.addEventListener("input", refreshSuggestVisibility);
    subjectInput.addEventListener("input", refreshSuggestVisibility);

    suggestBtn.addEventListener("click", async () => {
      suggestBtn.disabled = true;
      suggestBtn.textContent = "Suggesting…";
      try {
        const { subject } = await suggestEmailSubject(bodyEditor.getPlainText());
        if (!subjectInput.value.trim()) {
          subjectInput.value = subject;
          subjectInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
        suggestRow.hidden = true;
      } catch (err) {
        options.onStatus?.(
          "err",
          err instanceof Error ? err.message : "Subject suggestion failed",
        );
      } finally {
        suggestBtn.disabled = false;
        suggestBtn.textContent = "Suggest subject";
      }
    });
  }

  const variantRow = el("div", "email-compose-variants");
  if (canAutoGenerate) {
    mount.appendChild(variantRow);
  }

  fieldRow("Message", bodyEditor.root, { labelledBy: "email-compose-body-label" });

  let aiBusy = false;
  let repromptMode: "draft" | "variants" | null = null;

  const setAiBusy = (busy: boolean, message = ""): void => {
    aiBusy = busy;
    draftBtn.disabled = busy;
    redraftBtn.disabled = busy;
    repromptApply.disabled = busy;
    repromptInput.disabled = busy;
    mount.classList.toggle("is-ai-busy", busy);
    headStatus.textContent = message;
  };

  /**
   * Put the account signature below an empty body.
   *
   * Only ever applied to a blank editor, so it cannot duplicate itself or
   * clobber a restored draft — and the `-- ` separator is the RFC 3676
   * convention other clients use to fold it away.
   */
  const appendSignature = (): void => {
    const signature = options.account.signature?.trim();
    if (!signature || bodyEditor.getPlainText().trim()) return;
    bodyEditor.setPlainText(`\n\n-- \n${signature}`);
  };

  const applyModeDefaults = () => {
    // A restored draft is what the user actually typed, so it wins over
    // anything the reply/forward defaults would compute.
    if (options.draft) {
      const { to, cc, bcc, subject, body } = options.draft;
      if (to !== undefined) toInput.value = to;
      if (cc !== undefined) ccInput.value = cc;
      if (bcc !== undefined) bccInput.value = bcc;
      if (cc) revealCc();
      if (bcc) revealBcc();
      if (subject !== undefined) subjectInput.value = subject;
      if (body !== undefined) bodyEditor.setPlainText(body);
      return;
    }

    const latest = options.messages?.[options.messages.length - 1];
    const accountEmail =
      options.account.username || options.account.fromAddress || "";

    if (options.mode === "new") {
      toInput.value = "";
      subjectInput.value = "";
      appendSignature();
      return;
    }

    if (!latest) return;

    if (options.mode === "reply") {
      toInput.value = resolveReplyTarget(
        options.messages ?? [],
        collectAccountEmails(options.account),
      );
      subjectInput.value = latest.subject.startsWith("Re:")
        ? latest.subject
        : `Re: ${latest.subject}`;
    }

    if (options.mode === "replyAll") {
      toInput.value = collectRecipients(
        options.messages ?? [],
        accountEmail,
      ).join(", ");
      subjectInput.value = latest.subject.startsWith("Re:")
        ? latest.subject
        : `Re: ${latest.subject}`;
    }

    if (options.mode === "forward") {
      toInput.value = "";
      subjectInput.value = latest.subject.startsWith("Fwd:")
        ? latest.subject
        : `Fwd: ${latest.subject}`;

      if (!bodyEditor.getPlainText().trim()) {
        const quoted = (latest.bodyText ?? latest.bodyPreview ?? "").trim();
        bodyEditor.setPlainText(
          quoted
            ? `\n\n---------- Forwarded message ----------\n${quoted}`
            : "",
        );
      }
    }
  };

  const generateReply = async (instructions?: string): Promise<void> => {
    if (!options.threadId || aiBusy) return;

    setAiBusy(true, "Drafting…");
    try {
      const draft = await draftEmailReply({
        accountId: options.account.id,
        threadId: options.threadId,
        instructions: instructions?.trim() || undefined,
      });

      if (draft.to) toInput.value = draft.to;
      if (draft.subject) subjectInput.value = draft.subject;
      if (draft.body) bodyEditor.setPlainText(draft.body);

      redraftBtn.hidden = false;
      options.onStatus?.("ok", "Draft ready");
    } catch (err) {
      options.onStatus?.(
        "err",
        err instanceof Error ? err.message : "Draft failed",
      );
    } finally {
      setAiBusy(false);
    }
  };

  const loadDraft = async () => {
    applyModeDefaults();

    if (
      !options.threadId ||
      options.mode === "new" ||
      options.mode === "forward"
    ) {
      return;
    }

    if (canAutoGenerate && !bodyEditor.getPlainText().trim()) {
      await generateReply();
    }
  };

  const renderVariants = () => {
    variantRow.replaceChildren();
    if (!canAutoGenerate) return;

    const msg = options.selectedMessage;
    const variants = msg?.replyVariants ?? [];

    if (variants.length === 0) {
      const refreshAlts = el(
        "button",
        "email-dash-variant-reprompt",
        "Suggest alt drafts",
      ) as HTMLButtonElement;
      refreshAlts.type = "button";
      refreshAlts.addEventListener("click", async () => {
        if (!options.threadId || !msg) return;
        refreshAlts.disabled = true;
        try {
          await regenerateReplyVariants({
            accountId: options.account.id,
            messageId: msg.id,
            threadId: options.threadId,
          });
          options.onStatus?.("ok", "Alt drafts ready");
          options.onRefresh?.();
        } catch (err) {
          options.onStatus?.(
            "err",
            err instanceof Error ? err.message : "Alt drafts failed",
          );
        } finally {
          refreshAlts.disabled = false;
        }
      });
      variantRow.appendChild(refreshAlts);
      return;
    }

    variantRow.appendChild(
      el("span", "email-compose-variants-label", "Alt drafts"),
    );

    const chips = el("div", "email-compose-variant-chips");
    for (const variant of variants) {
      const chip = el("button", "email-dash-variant-chip") as HTMLButtonElement;
      chip.type = "button";
      chip.textContent = variant.label;
      chip.title = variant.body.slice(0, 160);
      chip.addEventListener("click", () => {
        bodyEditor.setPlainText(variant.body);
        redraftBtn.hidden = false;
      });
      chips.appendChild(chip);
    }
    variantRow.appendChild(chips);

    const refreshAlts = el(
      "button",
      "email-dash-variant-reprompt",
      "Refresh",
    ) as HTMLButtonElement;
    refreshAlts.type = "button";
    refreshAlts.title = "Regenerate alt drafts";
    refreshAlts.addEventListener("click", () => {
      if (!options.threadId || !msg) return;
      repromptMode = "variants";
      repromptRow.hidden = false;
      repromptInput.placeholder = "How should the alt drafts change? (optional)";
      repromptInput.focus();
    });
    variantRow.appendChild(refreshAlts);
  };

  draftBtn.addEventListener("click", () => void generateReply());

  redraftBtn.addEventListener("click", () => {
    repromptMode = "draft";
    repromptRow.hidden = false;
    repromptInput.placeholder = "Optional instructions for the draft…";
    repromptInput.focus();
  });

  repromptApply.addEventListener("click", async () => {
    const instructions = repromptInput.value.trim();
    repromptInput.value = "";

    if (repromptMode === "variants") {
      const msg = options.selectedMessage;
      if (!options.threadId || !msg) return;
      setAiBusy(true, "Refreshing alts…");
      try {
        await regenerateReplyVariants({
          accountId: options.account.id,
          messageId: msg.id,
          threadId: options.threadId,
          instructions: instructions || undefined,
        });
        options.onStatus?.("ok", "Alt drafts updated");
        options.onRefresh?.();
      } catch (err) {
        options.onStatus?.(
          "err",
          err instanceof Error ? err.message : "Refresh failed",
        );
      } finally {
        setAiBusy(false);
        repromptMode = null;
      }
      return;
    }

    void generateReply(instructions);
    repromptMode = null;
  });

  repromptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      repromptApply.click();
    }
    if (event.key === "Escape") {
      repromptInput.value = "";
      repromptInput.blur();
    }
  });

  // ---------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------

  const attachmentTray = createAttachmentTray({
    onStatus: options.onStatus,
    onChange: () => scheduleDraftSave(),
  });
  mount.appendChild(attachmentTray.root);
  const teardownDrop = enableAttachmentDrop(mount, attachmentTray);

  // ---------------------------------------------------------------------
  // Draft autosave
  // ---------------------------------------------------------------------

  let draftId = options.draftId ?? "";
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let discarded = false;
  // A send in flight must not be resurrected by a late autosave tick.
  let sending = false;

  const currentDraft = () => ({
    to: toInput.value,
    cc: ccInput.value,
    bcc: bccInput.value,
    subject: subjectInput.value,
    body: bodyEditor.getPlainText(),
    bodyHtml: bodyEditor.getHtml(),
    attachments: attachmentTray.getAttachments().map((att) => ({
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
    })),
  });

  const isBlank = (): boolean => {
    const draft = currentDraft();
    return (
      !draft.to.trim() &&
      !draft.cc.trim() &&
      !draft.bcc.trim() &&
      !draft.subject.trim() &&
      !draft.body.trim() &&
      draft.attachments.length === 0
    );
  };

  const saveDraftNow = async (): Promise<void> => {
    // An untouched composer should not litter the drafts list.
    if (discarded || sending || isBlank()) return;

    try {
      const { draft } = await saveEmailDraft({
        accountId: options.account.id,
        id: draftId || undefined,
        threadId: options.threadId ?? "",
        mode: options.mode,
        replyToKey: options.selectedMessage?.id ?? "",
        ...currentDraft(),
      });
      draftId = draft.id;
    } catch {
      // Autosave is a safety net, not a user-facing operation: a failed tick
      // will be retried by the next keystroke, and shouting about it while
      // someone is mid-sentence would be worse than staying quiet.
    }
  };

  function scheduleDraftSave(): void {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveDraftNow(), DRAFT_AUTOSAVE_MS);
  }

  for (const input of [toInput, ccInput, bccInput, subjectInput]) {
    input.addEventListener("input", scheduleDraftSave);
  }
  bodyEditor.root.addEventListener("input", scheduleDraftSave);

  const teardown = (): void => {
    clearTimeout(saveTimer);
    teardownDrop();
    toField.destroy();
    ccField.destroy();
    bccField.destroy();
  };

  void loadDraft();
  renderVariants();

  const actions = el("div", "email-compose-actions");

  // Inline notices that sit just above the action row instead of interrupting
  // with a dialog: an attachment warning and the send-later scheduler.
  const warnRow = el("div", "email-compose-warning");
  warnRow.hidden = true;
  warnRow.setAttribute("role", "alert");

  const scheduleRow = el("div", "email-compose-schedule");
  scheduleRow.hidden = true;

  const discardBtn = el("button", "email-btn", "Discard") as HTMLButtonElement;
  discardBtn.type = "button";
  discardBtn.addEventListener("click", () => {
    void (async () => {
      // Discard is only destructive once the user has confirmed it, and even
      // then the autosaved row is what gets removed — not unsaved text.
      if (!isBlank()) {
        const sure = await appConfirm(
          "Discard this draft? It will not be recoverable.",
          { confirmLabel: "Discard", danger: true },
        );
        if (!sure) return;
      }

      discarded = true;
      clearTimeout(saveTimer);
      if (draftId) {
        await deleteEmailDraft(options.account.id, draftId).catch(() => {});
      }
      teardown();
      mount.replaceChildren();
      mount.className = "email-reader-compose-mount";
    })();
  });

  const sendBtn = el(
    "button",
    "email-btn email-btn-primary",
    "Send",
  ) as HTMLButtonElement;
  sendBtn.type = "button";

  /** Trailing comma from an autocomplete pick is not an empty recipient. */
  const cleanRecipients = (value: string): string =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .join(", ");

  const dispatch = async (sendAt?: string, force = false): Promise<void> => {
    const to = cleanRecipients(toInput.value);
    const cc = cleanRecipients(ccInput.value);
    const bcc = cleanRecipients(bccInput.value);
    const subject = subjectInput.value.trim();
    const body = bodyEditor.getPlainText();
    const bodyHtml = bodyEditor.getHtml();
    const attachments = attachmentTray.getAttachments();

    if (!to || !subject) {
      options.onStatus?.("err", "To and subject are required");
      return;
    }

    // Catch the classic mistake before it goes out — an inline warning, not a
    // dialog. "Send anyway" re-dispatches with force set.
    if (attachments.length === 0 && ATTACHMENT_INTENT.test(body) && !force) {
      showAttachmentWarning(sendAt);
      return;
    }
    hideComposeNotices();

    const latest = options.messages?.[options.messages.length - 1];
    const replyHeaders =
      options.mode !== "new" && latest
        ? {
            inReplyTo: latest.messageId,
            references: buildReferencesChain(latest),
          }
        : undefined;

    sending = true;
    clearTimeout(saveTimer);

    try {
      // Queued, not sent: the undo window below is what confirms the send.
      const { entry } = await sendEmailMessage({
        accountId: options.account.id,
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject,
        body,
        bodyHtml,
        inReplyTo: replyHeaders?.inReplyTo,
        references: replyHeaders?.references,
        attachments: attachments.length ? attachments : undefined,
        sendAt,
      });

      // The message is on its way, so the draft row has served its purpose.
      if (draftId) {
        await deleteEmailDraft(options.account.id, draftId).catch(() => {});
        draftId = "";
      }

      showSendUndoToast(entry, {
        onStatus: options.onStatus,
        // Put the draft back in front of the user rather than silently
        // discarding what they just wrote.
        onUndo: () => {
          teardown();
          mountEmailCompose(mount, {
            ...options,
            draftId: undefined,
            draft: { to, cc, bcc, subject, body },
          });
        },
      });

      teardown();
      options.onSent?.();
    } catch (err) {
      sending = false;
      options.onStatus?.(
        "err",
        err instanceof Error ? err.message : "Send failed",
      );
    }
  };

  sendBtn.addEventListener("click", () => void dispatch());

  const laterBtn = el("button", "email-btn", "Send later") as HTMLButtonElement;
  laterBtn.type = "button";
  laterBtn.title = "Schedule this message";
  laterBtn.setAttribute("aria-expanded", "false");
  laterBtn.addEventListener("click", () => openSchedule());

  /** Collapse the schedule row and clear its active marker. */
  const closeSchedule = (): void => {
    scheduleRow.hidden = true;
    scheduleRow.replaceChildren();
    laterBtn.classList.remove("is-active");
    laterBtn.setAttribute("aria-expanded", "false");
  };

  /** Clear both inline notices once a send actually goes through. */
  const hideComposeNotices = (): void => {
    warnRow.hidden = true;
    warnRow.replaceChildren();
    closeSchedule();
  };

  /** Inline "no attachment" warning with a Send anyway escape hatch. */
  const showAttachmentWarning = (sendAt?: string): void => {
    warnRow.replaceChildren();
    warnRow.appendChild(
      el(
        "span",
        "email-compose-warning-text",
        "This message mentions an attachment, but none is attached.",
      ),
    );
    const anyway = el(
      "button",
      "email-btn email-btn-primary",
      "Send anyway",
    ) as HTMLButtonElement;
    anyway.type = "button";
    anyway.addEventListener("click", () => {
      warnRow.hidden = true;
      void dispatch(sendAt, true);
    });
    const keep = el("button", "email-btn", "Keep editing") as HTMLButtonElement;
    keep.type = "button";
    keep.addEventListener("click", () => {
      warnRow.hidden = true;
      warnRow.replaceChildren();
    });
    const row = el("div", "email-compose-notice-actions");
    row.append(anyway, keep);
    warnRow.appendChild(row);
    warnRow.hidden = false;
    anyway.focus();
  };

  /** Inline datetime picker for send-later, replacing the free-text prompt. */
  const openSchedule = (): void => {
    if (!scheduleRow.hidden) {
      closeSchedule();
      return;
    }
    warnRow.hidden = true;
    scheduleRow.replaceChildren();
    laterBtn.classList.add("is-active");
    laterBtn.setAttribute("aria-expanded", "true");

    const field = el("label", "email-compose-schedule-field");
    field.appendChild(el("span", "email-compose-schedule-label", "Send at"));
    const input = el("input", "email-input email-compose-schedule-input") as HTMLInputElement;
    input.type = "datetime-local";
    input.value = defaultSendLater();
    field.appendChild(input);

    const go = el("button", "email-btn email-btn-primary", "Schedule") as HTMLButtonElement;
    go.type = "button";
    const cancel = el("button", "email-btn", "Cancel") as HTMLButtonElement;
    cancel.type = "button";

    const schedule = (): void => {
      const value = input.value.trim();
      if (!value) {
        input.focus();
        return;
      }
      const parsed = new Date(value);
      if (!Number.isFinite(parsed.getTime())) {
        options.onStatus?.("err", "That is not a time I can read");
        return;
      }
      if (parsed.getTime() <= Date.now()) {
        options.onStatus?.("err", "Pick a time in the future");
        input.focus();
        return;
      }
      closeSchedule();
      void dispatch(parsed.toISOString());
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        schedule();
      } else if (event.key === "Escape") {
        closeSchedule();
      }
    });
    go.addEventListener("click", schedule);
    cancel.addEventListener("click", closeSchedule);

    const scheduleActions = el("div", "email-compose-notice-actions");
    scheduleActions.append(go, cancel);
    scheduleRow.append(field, scheduleActions);
    scheduleRow.hidden = false;
    input.focus();
  };

  actions.appendChild(discardBtn);
  actions.appendChild(laterBtn);
  actions.appendChild(sendBtn);
  mount.appendChild(scheduleRow);
  mount.appendChild(warnRow);
  mount.appendChild(actions);

  // Cmd/Ctrl+Enter sends from anywhere in the composer.
  mount.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void dispatch();
    }
  });
}

/** Tomorrow at 9am, local time, as a `datetime-local` input value. */
function defaultSendLater(): string {
  const when = new Date();
  when.setDate(when.getDate() + 1);
  when.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

function composeTitle(mode: ComposeMode): string {
  if (mode === "reply") return "Reply";
  if (mode === "replyAll") return "Reply all";
  if (mode === "forward") return "Forward";
  return "New message";
}
