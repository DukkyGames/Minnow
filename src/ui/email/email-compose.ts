/**

 * Inline compose block for the reading pane footer.

 */

import type { EmailAccount, EmailMessage } from "../../email/client";

import { draftEmailReply, sendEmailMessage } from "../../email/client";

import { regenerateReplyVariants } from "../../email/client-ext";

export type ComposeMode = "reply" | "replyAll" | "forward" | "new";

export interface EmailComposeOptions {
  account: EmailAccount;

  mode: ComposeMode;

  threadId?: string;

  messages?: EmailMessage[];

  selectedMessage?: EmailMessage;

  onStatus?: (state: "ok" | "err", message: string) => void;

  onSent?: () => void;
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

/** Extract bare email from a From/To header. */

function extractEmail(header: string): string {
  const match = header.match(/<([^>]+)>/);

  return (match?.[1] ?? header).trim();
}

/** Collect unique recipient emails from thread messages. */

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

/**

 * Mount inline compose UI at the bottom of the reading pane.

 */

export function mountEmailCompose(
  mount: HTMLElement,
  options: EmailComposeOptions,
): void {
  mount.replaceChildren();

  mount.className = "email-compose is-open";

  const head = el("div", "email-compose-head");

  head.appendChild(el("p", "email-compose-title", composeTitle(options.mode)));

  mount.appendChild(head);

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

  const fieldRow = (label: string, input: HTMLElement) => {
    const row = el("label", "email-compose-field");

    row.appendChild(el("span", "email-compose-field-label", label));

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

  const bodyArea = el("textarea", "email-compose-body") as HTMLTextAreaElement;

  bodyArea.rows = 8;

  bodyArea.placeholder = "Write your message…";

  fieldRow("To", toInput);

  if (options.mode === "replyAll" || options.mode === "forward") {
    fieldRow("Cc", ccInput);
  }

  fieldRow("Subject", subjectInput);

  fieldRow("Message", bodyArea);

  const variantRow = el("div", "email-compose-variants");

  mount.appendChild(variantRow);

  const applyModeDefaults = () => {
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
      toInput.value = extractEmail(latest.from);

      subjectInput.value = latest.subject.startsWith("Re:")
        ? latest.subject
        : `Re: ${latest.subject}`;
    }

    if (options.mode === "replyAll") {
      const recipients = collectRecipients(
        options.messages ?? [],
        accountEmail,
      );

      toInput.value = recipients.join(", ");

      subjectInput.value = latest.subject.startsWith("Re:")
        ? latest.subject
        : `Re: ${latest.subject}`;
    }

    if (options.mode === "forward") {
      toInput.value = "";

      subjectInput.value = latest.subject.startsWith("Fwd:")
        ? latest.subject
        : `Fwd: ${latest.subject}`;

      if (!bodyArea.value.trim()) {
        const quoted = (latest.bodyText ?? latest.bodyPreview ?? "").trim();

        bodyArea.value = quoted
          ? `\n\n---------- Forwarded message ----------\n${quoted}`
          : "";
      }
    }
  };

  const loadDraft = async () => {
    if (
      !options.threadId ||
      options.mode === "new" ||
      options.mode === "forward"
    ) {
      applyModeDefaults();

      return;
    }

    try {
      const draft = await draftEmailReply({
        accountId: options.account.id,

        threadId: options.threadId,
      });

      if (!toInput.value) toInput.value = draft.to;

      if (!subjectInput.value) subjectInput.value = draft.subject;

      if (!bodyArea.value.trim()) bodyArea.value = draft.body;
    } catch {
      applyModeDefaults();
    }
  };

  const renderVariants = () => {
    variantRow.replaceChildren();

    const msg = options.selectedMessage;

    const variants = msg?.replyVariants ?? [];

    if (variants.length === 0) return;

    variantRow.appendChild(
      el("span", "email-compose-variants-label", "Quick drafts"),
    );

    const chips = el("div", "email-compose-variant-chips");

    for (const variant of variants) {
      const chip = el("button", "email-dash-variant-chip") as HTMLButtonElement;

      chip.type = "button";

      chip.textContent = variant.label;

      chip.addEventListener("click", () => {
        bodyArea.value = variant.body;
      });

      chips.appendChild(chip);
    }

    variantRow.appendChild(chips);

    const regen = el(
      "button",
      "email-btn email-compose-regen",
      "Regenerate",
    ) as HTMLButtonElement;

    regen.type = "button";

    regen.addEventListener("click", async () => {
      if (!options.threadId || !msg) return;

      const instructions =
        window.prompt("Reprompt instructions (optional)") ?? "";

      try {
        await regenerateReplyVariants({
          accountId: options.account.id,

          messageId: msg.id,

          threadId: options.threadId,

          instructions: instructions.trim() || undefined,
        });

        options.onStatus?.("ok", "Variants updated");

        options.onSent?.();
      } catch (err) {
        options.onStatus?.(
          "err",
          err instanceof Error ? err.message : "Regenerate failed",
        );
      }
    });

    variantRow.appendChild(regen);
  };

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

    const subject = subjectInput.value.trim();

    const body = bodyArea.value;

    if (!to || !subject) {
      options.onStatus?.("err", "To and subject are required");

      return;
    }

    const ok = window.confirm(`Send to ${to}?\n\nSubject: ${subject}`);

    if (!ok) return;

    const latest = options.messages?.[options.messages.length - 1];

    try {
      await sendEmailMessage({
        accountId: options.account.id,

        to,

        subject,

        body,

        inReplyTo: options.mode !== "new" ? latest?.messageId : undefined,

        references: options.mode !== "new" ? latest?.messageId : undefined,

        confirmed: true,
      });

      options.onStatus?.("ok", "Email sent");

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
