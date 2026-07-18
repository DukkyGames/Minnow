/**
 * Inline compose block for the reading pane footer.
 */

import type { EmailAccount, EmailMessage } from "../../email/client";
import {
  draftEmailReply,
  improveEmailText,
  sendEmailMessage,
} from "../../email/client";
import { regenerateReplyVariants } from "../../email/client-ext";
import {
  buildReferencesChain,
  collectAccountEmails,
  extractEmailAddress,
  resolveReplyTarget,
} from "../../email/reply-headers";
import { createComposeBodyEditor } from "./email-compose-editor";
import { showSendUndoToast } from "./email-undo-toast";

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
  draft?: { to?: string; cc?: string; subject?: string; body?: string };
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

  const tabs = el("div", "email-compose-tabs");
  for (const mode of ["reply", "replyAll", "forward", "new"] as ComposeMode[]) {
    const tab = el("button", "email-compose-tab") as HTMLButtonElement;
    tab.type = "button";
    tab.textContent =
      mode === "replyAll"
        ? "Reply all"
        : mode.charAt(0).toUpperCase() + mode.slice(1);
    tab.classList.toggle("is-active", mode === options.mode);
    tab.addEventListener("click", () => {
      mountEmailCompose(mount, { ...options, mode });
    });
    tabs.appendChild(tab);
  }
  mount.appendChild(tabs);

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

  const toInput = el("input", "email-input") as HTMLInputElement;
  toInput.placeholder = "Recipients";
  toInput.name = "to";

  const ccInput = el("input", "email-input") as HTMLInputElement;
  ccInput.placeholder = "Cc (optional)";
  ccInput.name = "cc";

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

  fieldRow("To", toInput);
  if (options.mode === "replyAll" || options.mode === "forward") {
    fieldRow("Cc", ccInput);
  }
  fieldRow("Subject", subjectInput);

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

  const applyModeDefaults = () => {
    // A restored draft is what the user actually typed, so it wins over
    // anything the reply/forward defaults would compute.
    if (options.draft) {
      const { to, cc, subject, body } = options.draft;
      if (to !== undefined) toInput.value = to;
      if (cc !== undefined) ccInput.value = cc;
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

  void loadDraft();
  renderVariants();

  const actions = el("div", "email-compose-actions");

  const discardBtn = el("button", "email-btn", "Discard") as HTMLButtonElement;
  discardBtn.type = "button";
  discardBtn.addEventListener("click", () => {
    mount.replaceChildren();
    mount.className = "email-reader-compose-mount";
  });

  const sendBtn = el(
    "button",
    "email-btn email-btn-primary",
    "Send",
  ) as HTMLButtonElement;
  sendBtn.type = "button";

  sendBtn.addEventListener("click", async () => {
    const to = toInput.value.trim();
    const cc = ccInput.value.trim();
    const subject = subjectInput.value.trim();
    const body = bodyEditor.getPlainText();
    const bodyHtml = bodyEditor.getHtml();

    if (!to || !subject) {
      options.onStatus?.("err", "To and subject are required");
      return;
    }

    const latest = options.messages?.[options.messages.length - 1];
    const replyHeaders =
      options.mode !== "new" && latest
        ? {
            inReplyTo: latest.messageId,
            references: buildReferencesChain(latest),
          }
        : undefined;

    try {
      // Queued, not sent: the undo window below is what confirms the send.
      const { entry } = await sendEmailMessage({
        accountId: options.account.id,
        to,
        cc: cc || undefined,
        subject,
        body,
        bodyHtml,
        inReplyTo: replyHeaders?.inReplyTo,
        references: replyHeaders?.references,
      });

      showSendUndoToast(entry, {
        onStatus: options.onStatus,
        // Put the draft back in front of the user rather than silently
        // discarding what they just wrote.
        onUndo: () => {
          mountEmailCompose(mount, { ...options, draft: { to, cc, subject, body } });
        },
      });

      options.onSent?.();
    } catch (err) {
      options.onStatus?.(
        "err",
        err instanceof Error ? err.message : "Send failed",
      );
    }
  });

  actions.appendChild(discardBtn);
  actions.appendChild(sendBtn);
  mount.appendChild(actions);
}

function composeTitle(mode: ComposeMode): string {
  if (mode === "reply") return "Reply";
  if (mode === "replyAll") return "Reply all";
  if (mode === "forward") return "Forward";
  return "New message";
}
