import type {
  EmailAccount,
  EmailFollowup,
  EmailInboxSummary,
  EmailNarrativeDigest,
  EmailPendingAction,
  ReplyVariant,
} from '../../email/client';
import { syncEmailFolder } from '../../email/client';
import {
  applyPendingEmailAction,
  dismissAttentionHighlight,
  dismissEmailFollowup,
  dismissPendingEmailAction,
  fetchInboxSummary,
  queueDigestActionGroup,
  regenerateReplyVariants,
  sendPriorityFeedback,
  sendReplyVariant,
} from '../../email/client-ext';
import { EMAIL_ICONS } from './email-icons';
import { showSendUndoToast } from './email-undo-toast';

export interface EmailDashboardOptions {
  account: EmailAccount;
  onStatus?: (state: 'ok' | 'err', message: string) => void;
  /** Toggle the chrome sync progress bar (ref-counted by the panel). */
  onSyncActivity?: (active: boolean) => void;
  onOpenThread: (threadId: string) => void;
  onOpenMail: () => void;
  onRefresh?: () => void;
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

/** Map triage urgency to row and badge modifier classes. */
function urgencyClass(urgency?: string): string {
  if (urgency === 'high') return 'email-urgency-high';
  if (urgency === 'low') return 'email-urgency-low';
  return 'email-urgency-normal';
}

/** Short relative label for summary generation time. */
function formatDigestTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'just now';
  const deltaMs = Date.now() - date.getTime();
  if (deltaMs < 60_000) return 'just now';
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── Digest ───────────────────────────────────────────────────────────────────

/** Quick-reply block for one highlight thread. */
function renderVariantChips(
  mount: HTMLElement,
  account: EmailAccount,
  highlight: EmailInboxSummary['highlights'][0],
  options: EmailDashboardOptions,
): void {
  const variants = highlight.replyVariants ?? [];
  if (variants.length === 0) return;

  const block = el('div', 'email-dash-replies');
  block.appendChild(el('span', 'email-dash-replies-label', 'Quick replies'));

  const row = el('div', 'email-dash-variants');
  const panel = el('div', 'email-dash-reply-panel');
  panel.hidden = true;

  const reprompt = el('button', 'email-dash-variant-reprompt', 'Reprompt') as HTMLButtonElement;
  reprompt.type = 'button';
  reprompt.setAttribute('aria-expanded', 'false');

  const chips: HTMLButtonElement[] = [];

  /** Collapse the panel and clear every open/active marker. */
  const closePanel = (): void => {
    panel.hidden = true;
    panel.replaceChildren();
    for (const chip of chips) {
      chip.classList.remove('is-active');
      chip.setAttribute('aria-expanded', 'false');
    }
    reprompt.classList.remove('is-active');
    reprompt.setAttribute('aria-expanded', 'false');
  };

  const openPreview = (variant: ReplyVariant, chip: HTMLButtonElement): void => {
    const alreadyOpen = chip.classList.contains('is-active');
    closePanel();
    if (alreadyOpen) return;

    chip.classList.add('is-active');
    chip.setAttribute('aria-expanded', 'true');

    const body = el('p', 'email-dash-reply-preview', variant.body);

    const actions = el('div', 'email-dash-reply-actions');
    const sendBtn = el('button', 'email-btn email-btn-primary', 'Send') as HTMLButtonElement;
    sendBtn.type = 'button';
    const editBtn = el('button', 'email-btn', 'Edit') as HTMLButtonElement;
    editBtn.type = 'button';
    editBtn.title = 'Open the conversation to edit before sending';
    const cancelBtn = el('button', 'email-btn email-dash-reply-cancel', 'Cancel') as HTMLButtonElement;
    cancelBtn.type = 'button';

    sendBtn.addEventListener('click', async () => {
      sendBtn.disabled = true;
      try {
        const { entry } = await sendReplyVariant({
          accountId: account.id,
          messageId: highlight.messageId,
          threadId: highlight.threadId,
          variantId: variant.id,
        });
        showSendUndoToast(entry, { onStatus: options.onStatus });
        closePanel();
      } catch (err) {
        sendBtn.disabled = false;
        options.onStatus?.('err', err instanceof Error ? err.message : 'Send failed');
      }
    });
    editBtn.addEventListener('click', () => {
      closePanel();
      options.onOpenThread(highlight.threadId);
    });
    cancelBtn.addEventListener('click', closePanel);

    actions.append(sendBtn, editBtn, cancelBtn);
    panel.replaceChildren(body, actions);
    panel.hidden = false;
    sendBtn.focus();
  };

  const openReprompt = (): void => {
    const alreadyOpen = reprompt.classList.contains('is-active');
    closePanel();
    if (alreadyOpen) return;

    reprompt.classList.add('is-active');
    reprompt.setAttribute('aria-expanded', 'true');

    const field = el('label', 'email-dash-reprompt-field');
    field.appendChild(el('span', 'email-dash-reprompt-label', 'Adjust the replies'));
    const input = el('input', 'email-input email-dash-reprompt-input') as HTMLInputElement;
    input.type = 'text';
    input.placeholder = 'e.g. warmer, shorter, ask for a date';
    field.appendChild(input);

    const actions = el('div', 'email-dash-reply-actions');
    const applyBtn = el('button', 'email-btn email-btn-primary', 'Regenerate') as HTMLButtonElement;
    applyBtn.type = 'button';
    const cancelBtn = el('button', 'email-btn email-dash-reply-cancel', 'Cancel') as HTMLButtonElement;
    cancelBtn.type = 'button';

    const submit = async (): Promise<void> => {
      const instructions = input.value.trim();
      if (!instructions) {
        input.focus();
        return;
      }
      applyBtn.disabled = true;
      try {
        await regenerateReplyVariants({
          accountId: account.id,
          messageId: highlight.messageId,
          threadId: highlight.threadId,
          instructions,
        });
        options.onStatus?.('ok', 'Variants regenerated');
        closePanel();
        options.onRefresh?.();
      } catch (err) {
        applyBtn.disabled = false;
        options.onStatus?.('err', err instanceof Error ? err.message : 'Reprompt failed');
      }
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void submit();
      } else if (event.key === 'Escape') {
        closePanel();
      }
    });
    applyBtn.addEventListener('click', () => void submit());
    cancelBtn.addEventListener('click', closePanel);

    actions.append(applyBtn, cancelBtn);
    panel.replaceChildren(field, actions);
    panel.hidden = false;
    input.focus();
  };

  for (const variant of variants) {
    const chip = el('button', 'email-dash-variant-chip') as HTMLButtonElement;
    chip.type = 'button';
    chip.textContent = variant.label;
    chip.title = 'Preview this reply';
    chip.setAttribute('aria-expanded', 'false');
    chip.addEventListener('click', () => openPreview(variant, chip));
    chips.push(chip);
    row.appendChild(chip);
  }

  reprompt.addEventListener('click', openReprompt);
  row.appendChild(reprompt);

  block.append(row, panel);
  mount.appendChild(block);
}

/** Horizontal instrumentation cells (stats-strip vocabulary). */
function renderInstrumentStrip(
  mount: HTMLElement,
  summary: EmailInboxSummary,
): void {
  const strip = el('div', 'email-dash-instrument');
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', 'Triage counts');

  const cells: Array<{ key: string; label: string; value: number; tone: string }> = [
    { key: 'high', label: 'High', value: summary.stats.high, tone: 'danger' },
    { key: 'normal', label: 'Normal', value: summary.stats.normal, tone: 'accent' },
    { key: 'low', label: 'Low', value: summary.stats.low, tone: 'muted' },
    { key: 'unread', label: 'Unread', value: summary.unread, tone: 'warning' },
  ];

  for (const cell of cells) {
    const node = el('div', `email-dash-meter email-dash-meter--${cell.tone}`);
    node.dataset.metric = cell.key;
    node.appendChild(el('span', 'email-dash-meter-name', cell.label));
    node.appendChild(el('span', 'email-dash-meter-val', String(cell.value)));
    strip.appendChild(node);
  }

  mount.appendChild(strip);
}

/** Human label for a triage category chip. */
function categoryLabel(category?: string): string {
  const labels: Record<string, string> = {
    needs_reply: 'needs reply',
    fyi: 'fyi',
    newsletter: 'newsletter',
    notification: 'notification',
    receipt: 'receipt',
    calendar: 'calendar',
    security: 'security',
  };
  return labels[category ?? ''] ?? '';
}

/** Hide digest chips whose messages are already sitting in the review queue so Refresh cannot stack duplicate pending rows for the same suggestion. */
export function filterDigestActionGroups(
  digest: EmailNarrativeDigest,
  pendingActions: EmailPendingAction[] = [],
): EmailNarrativeDigest['actionGroups'] {
  const pendingMessageIds = new Set(
    pendingActions
      .filter((row) => row.state === 'pending')
      .flatMap((row) => row.messageIds.map(String)),
  );
  return (digest.actionGroups ?? []).filter(
    (group) => !group.messageIds.some((id) => pendingMessageIds.has(String(id))),
  );
}

/** Digest action-group chips — queue into the review strip on click (§3.7). */
export function renderDigestActionGroups(
  mount: HTMLElement,
  account: EmailAccount,
  digest: EmailNarrativeDigest,
  options: EmailDashboardOptions,
  pendingActions: EmailPendingAction[] = [],
): void {
  const groups = filterDigestActionGroups(digest, pendingActions);
  if (groups.length === 0) return;

  const row = el('div', 'email-dash-action-groups');
  for (const group of groups) {
    const chip = el('button', 'email-dash-action-chip') as HTMLButtonElement;
    chip.type = 'button';
    const copy = el('span', 'email-dash-action-copy');
    copy.append(
      el('span', 'email-dash-action-label', group.label),
      el(
        'span',
        'email-dash-action-meta',
        `${group.messageIds.length} message${group.messageIds.length === 1 ? '' : 's'} · queues for review`,
      ),
    );
    chip.append(copy, el('span', 'email-dash-action-cta', 'Review'));
    chip.title = `${group.messageIds.length} messages — queues for review before anything runs`;
    chip.addEventListener('click', async () => {
      chip.disabled = true;
      try {
        const { pending } = await queueDigestActionGroup(account.id, group.id);
        chip.remove();
        if (row.childElementCount === 0) row.remove();
        options.onStatus?.(
          'ok',
          pending.state === 'applied' ? `Applied: ${pending.label}` : `Queued for review: ${pending.label}`,
        );
        options.onRefresh?.();
      } catch (err) {
        chip.disabled = false;
        options.onStatus?.('err', err instanceof Error ? err.message : 'Could not queue action');
      }
    });
    row.appendChild(chip);
  }
  mount.appendChild(row);
}

/** Latest dashboard options per review mount (updated on every render). */
const pendingReviewOptions = new WeakMap<HTMLElement, EmailDashboardOptions>();

/** One delegated click handler per mount so Apply/Dismiss survive `replaceChildren()` on the mount's descendants. */
function ensurePendingReviewDelegation(mount: HTMLElement): void {
  if (mount.dataset.pendingReviewDelegated === '1') return;
  mount.dataset.pendingReviewDelegated = '1';

  mount.addEventListener('click', (event) => {
    const options = pendingReviewOptions.get(mount);
    const accountId = mount.dataset.pendingReviewAccountId;
    if (!options || !accountId) return;

    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '.email-dash-review-controls button[data-pending-verb]',
    );
    if (!btn || btn.disabled) return;

    const row = btn.closest('.email-dash-review-row');
    const actionId = row?.getAttribute('data-pending-id');
    const label = row?.getAttribute('data-pending-label') ?? 'action';
    const verb = btn.dataset.pendingVerb;
    if (!actionId || !verb) return;

    const controls = btn.closest('.email-dash-review-controls');
    if (!controls) return;
    const rowButtons = [...controls.querySelectorAll<HTMLButtonElement>('button')];

    const run = async (fn: () => Promise<unknown>, okMessage: string) => {
      for (const control of rowButtons) control.disabled = true;
      try {
        await fn();
        row?.remove();
        const section = mount.querySelector('.email-dash-review');
        if (section && section.querySelectorAll('.email-dash-review-row').length === 0) {
          section.remove();
        }
        options.onStatus?.('ok', okMessage);
        options.onRefresh?.();
      } catch (err) {
        for (const control of rowButtons) control.disabled = false;
        options.onStatus?.('err', err instanceof Error ? err.message : 'Action failed');
      }
    };

    if (verb === 'apply') {
      void run(() => applyPendingEmailAction(accountId, actionId), `Applied: ${label}`);
      return;
    }
    if (verb === 'always') {
      void run(
        () => applyPendingEmailAction(accountId, actionId, { alwaysAllow: true }),
        `Applied — future ${row?.getAttribute('data-pending-action') ?? 'matching'} suggestions run automatically`,
      );
      return;
    }
    if (verb === 'dismiss') {
      void run(() => dismissPendingEmailAction(accountId, actionId), 'Dismissed');
    }
  });
}

// ── Pending actions ──────────────────────────────────────────────────────────

/** Review strip for AI-suggested batches awaiting Apply/Dismiss (§3.7). */
export function renderPendingActions(
  mount: HTMLElement,
  account: EmailAccount,
  pendingActions: EmailPendingAction[],
  options: EmailDashboardOptions,
): void {
  const pending = pendingActions.filter((row) => row.state === 'pending');
  if (pending.length === 0) return;

  ensurePendingReviewDelegation(mount);
  pendingReviewOptions.set(mount, options);
  mount.dataset.pendingReviewAccountId = account.id;

  const section = el('section', 'email-dash-review');
  section.appendChild(el('h3', 'email-dash-section-label', 'Ready for review'));

  for (const action of pending) {
    const row = el('div', 'email-dash-review-row');
    row.setAttribute('data-pending-id', action.id);
    row.setAttribute('data-pending-label', action.label);
    row.setAttribute('data-pending-action', action.action);

    const main = el('div', 'email-dash-review-main');
    main.appendChild(el('span', 'email-dash-review-label', action.label));
    main.appendChild(
      el(
        'span',
        'email-dash-review-meta',
        `${action.messageIds.length} messages · from ${action.source === 'digest' ? 'inbox digest' : 'chat agent'}`,
      ),
    );
    row.appendChild(main);

    const controls = el('div', 'email-dash-review-controls');

    const applyBtn = el('button', 'email-btn email-btn-primary', 'Apply') as HTMLButtonElement;
    applyBtn.type = 'button';
    applyBtn.dataset.pendingVerb = 'apply';

    const dismissBtn = el('button', 'email-btn', 'Dismiss') as HTMLButtonElement;
    dismissBtn.type = 'button';
    dismissBtn.dataset.pendingVerb = 'dismiss';

    const alwaysBtn = el('button', 'email-btn', 'Always allow') as HTMLButtonElement;
    alwaysBtn.type = 'button';
    alwaysBtn.dataset.pendingVerb = 'always';
    alwaysBtn.title = `Apply now and auto-apply future "${action.action}" suggestions from this source`;

    controls.appendChild(applyBtn);
    if (action.action !== 'delete') {
      controls.appendChild(alwaysBtn);
    }
    controls.appendChild(dismissBtn);
    row.appendChild(controls);
    section.appendChild(row);
  }

  mount.appendChild(section);
}

// ── Followups ────────────────────────────────────────────────────────────────

/** "Waiting on" — sent mail still expecting a reply (§3.4). */
function renderFollowups(
  mount: HTMLElement,
  account: EmailAccount,
  followups: EmailFollowup[],
  options: EmailDashboardOptions,
): void {
  if (followups.length === 0) return;

  const section = el('section', 'email-dash-waiting');
  section.appendChild(el('h3', 'email-dash-section-label', 'Waiting on'));

  for (const followup of followups) {
    const row = el('div', 'email-dash-waiting-row');
    const overdue = new Date(followup.expectedBy).getTime() < Date.now();
    if (overdue) row.classList.add('is-overdue');

    const main = el('div', 'email-dash-waiting-main');
    main.appendChild(el('span', 'email-dash-waiting-who', followup.to));
    main.appendChild(el('span', 'email-dash-waiting-subject', followup.subject));
    main.appendChild(
      el(
        'span',
        'email-dash-waiting-when',
        overdue ? 'overdue' : `by ${new Date(followup.expectedBy).toLocaleDateString()}`,
      ),
    );
    row.appendChild(main);

    const controls = el('div', 'email-dash-waiting-controls');
    if (followup.threadId) {
      const draftBtn = el('button', 'email-btn', 'Draft follow-up') as HTMLButtonElement;
      draftBtn.type = 'button';
      draftBtn.addEventListener('click', () => options.onOpenThread(followup.threadId));
      controls.appendChild(draftBtn);
    }
    const doneBtn = el('button', 'email-btn email-dash-waiting-dismiss', 'Dismiss') as HTMLButtonElement;
    doneBtn.type = 'button';
    doneBtn.title = 'Stop waiting for a reply';
    doneBtn.addEventListener('click', async () => {
      doneBtn.disabled = true;
      try {
        await dismissEmailFollowup(account.id, followup.id);
        options.onRefresh?.();
      } catch (err) {
        doneBtn.disabled = false;
        options.onStatus?.('err', err instanceof Error ? err.message : 'Dismiss failed');
      }
    });
    controls.appendChild(doneBtn);
    row.appendChild(controls);
    section.appendChild(row);
  }

  mount.appendChild(section);
}

/** Inline "wrong priority?" feedback — writes a sender override (§3.2). */
function renderPriorityFeedback(
  mount: HTMLElement,
  account: EmailAccount,
  highlight: EmailInboxSummary['highlights'][0],
  options: EmailDashboardOptions,
): void {
  const wrap = el('div', 'email-dash-feedback');
  const toggle = el('button', 'email-dash-feedback-toggle', 'Wrong priority?') as HTMLButtonElement;
  toggle.type = 'button';

  const choices = el('div', 'email-dash-feedback-choices');
  choices.hidden = true;

  const mkChoice = (label: string, level: 'high' | 'low' | '') => {
    const btn = el('button', 'email-dash-feedback-chip', label) as HTMLButtonElement;
    btn.type = 'button';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await sendPriorityFeedback(account.id, highlight.from, level);
        options.onStatus?.('ok', level ? `Sender pinned always-${level}` : 'Override cleared');
        options.onRefresh?.();
      } catch (err) {
        btn.disabled = false;
        options.onStatus?.('err', err instanceof Error ? err.message : 'Feedback failed');
      }
    });
    return btn;
  };

  toggle.addEventListener('click', () => {
    choices.hidden = !choices.hidden;
  });

  choices.appendChild(mkChoice('Always high', 'high'));
  choices.appendChild(mkChoice('Always low', 'low'));
  choices.appendChild(mkChoice('Reset', ''));

  wrap.appendChild(toggle);
  wrap.appendChild(choices);
  mount.appendChild(wrap);
}

/** One attention-queue row for a triaged highlight thread. */
export function renderHighlightRow(
  list: HTMLElement,
  highlight: EmailInboxSummary['highlights'][0],
  account: EmailAccount,
  options: EmailDashboardOptions,
): void {
  const bucket = highlight.priorityBucket ?? highlight.urgency;
  const row = el('article', `email-dash-row ${urgencyClass(bucket)}`);
  if (highlight.unseen) {
    row.classList.add('is-unread');
  }

  const dismissBtn = el('button', 'email-icon-btn email-dash-row-dismiss') as HTMLButtonElement;
  dismissBtn.type = 'button';
  dismissBtn.title = 'Dismiss from needs attention';
  dismissBtn.setAttribute('aria-label', 'Dismiss from needs attention');
  dismissBtn.innerHTML = EMAIL_ICONS.close;
  dismissBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    dismissBtn.disabled = true;
    void (async () => {
      try {
        await dismissAttentionHighlight(account.id, highlight.messageId);
        row.remove();
        options.onStatus?.('ok', 'Dismissed');
        options.onRefresh?.();
      } catch (err) {
        dismissBtn.disabled = false;
        options.onStatus?.('err', err instanceof Error ? err.message : 'Dismiss failed');
      }
    })();
  });
  row.appendChild(dismissBtn);

  const main = el('button', 'email-dash-row-main') as HTMLButtonElement;
  main.type = 'button';
  main.addEventListener('click', () => options.onOpenThread(highlight.threadId));

  const titleLine = el('div', 'email-dash-row-title');
  if (highlight.unseen) {
    titleLine.appendChild(el('span', 'email-dash-unread-dot', ''));
  }
  titleLine.appendChild(el('span', 'email-dash-row-subject', highlight.subject || '(no subject)'));
  main.appendChild(titleLine);

  const meta = el('div', 'email-dash-row-meta');
  meta.appendChild(el('span', 'email-dash-row-from', highlight.from));
  const badge = el('span', `email-urgency-badge ${urgencyClass(bucket)}`);
  badge.textContent = bucket;
  meta.appendChild(badge);
  const category = categoryLabel(highlight.category);
  if (category) {
    meta.appendChild(el('span', 'email-category-chip', category));
  }
  if (highlight.deadline) {
    meta.appendChild(el('span', 'email-deadline-chip', `due ${highlight.deadline}`));
  }
  main.appendChild(meta);

  main.appendChild(el('p', 'email-dash-row-summary', highlight.summary));
  row.appendChild(main);

  renderPriorityFeedback(row, account, highlight, options);
  renderVariantChips(row, account, highlight, options);
  list.appendChild(row);
}

// ── Dashboard ────────────────────────────────────────────────────────────────

/**
 * Render the default inbox dashboard view.
 */
export async function renderEmailDashboard(
  mount: HTMLElement,
  options: EmailDashboardOptions,
): Promise<void> {
  mount.replaceChildren(el('p', 'email-loading', 'Loading inbox summary…'));

  try {
    let payload = await fetchInboxSummary(options.account.id);

    if (payload.summary.text.includes('Sync to fetch new mail')) {
      mount.replaceChildren(el('p', 'email-loading', 'Syncing inbox…'));
      options.onSyncActivity?.(true);
      try {
        await syncEmailFolder(options.account.id, 'INBOX');
        payload = await fetchInboxSummary(options.account.id);
      } catch (syncErr) {
        options.onStatus?.(
          'err',
          syncErr instanceof Error ? syncErr.message : 'Inbox sync failed',
        );
      } finally {
        options.onSyncActivity?.(false);
      }
    }

    const { summary, digest, pendingActions, followups } = payload;

    mount.replaceChildren();
    mount.className = 'email-dash';

    const head = el('header', 'email-dash-head');
    const headMain = el('div', 'email-dash-head-main');
    headMain.appendChild(el('h2', 'email-dash-title', 'Inbox digest'));
    const metaParts = [formatDigestTime(summary.generatedAt)];
    if (summary.unread > 0) {
      metaParts.push(`${summary.unread} unread`);
    }
    headMain.appendChild(el('p', 'email-dash-meta', metaParts.join(' · ')));
    head.appendChild(headMain);

    const openMail = el('button', 'email-btn email-btn-primary email-dash-open-mail', 'Open inbox') as HTMLButtonElement;
    openMail.type = 'button';
    openMail.addEventListener('click', options.onOpenMail);
    head.appendChild(openMail);
    mount.appendChild(head);

    renderInstrumentStrip(mount, summary);

    const brief = (digest?.narrative ?? '').trim() || summary.text.trim();
    if (brief) {
      const briefNode = el('p', 'email-dash-brief', brief);
      if (digest?.narrative) briefNode.classList.add('is-narrative');
      mount.appendChild(briefNode);
    }
    if (digest) {
      renderDigestActionGroups(mount, options.account, digest, options, pendingActions ?? []);
    }

    renderPendingActions(mount, options.account, pendingActions ?? [], options);
    renderFollowups(mount, options.account, followups ?? [], options);

    const queue = el('section', 'email-dash-queue');
    queue.appendChild(el('h3', 'email-dash-section-label', 'Needs attention'));

    const list = el('div', 'email-dash-rows');
    if (summary.highlights.length === 0) {
      const empty = el('div', 'email-dash-empty');
      empty.appendChild(el('p', 'email-dash-empty-title', 'Nothing queued yet'));
      empty.appendChild(
        el(
          'p',
          'email-dash-empty-copy',
          'Sync your inbox or enable polling so triage can surface threads here.',
        ),
      );
      const openEmpty = el('button', 'email-btn', 'Open inbox') as HTMLButtonElement;
      openEmpty.type = 'button';
      openEmpty.addEventListener('click', options.onOpenMail);
      empty.appendChild(openEmpty);
      list.appendChild(empty);
    } else {
      for (const highlight of summary.highlights.slice(0, 8)) {
        renderHighlightRow(list, highlight, options.account, options);
      }
    }

    queue.appendChild(list);
    mount.appendChild(queue);
  } catch (err) {
    mount.replaceChildren(
      el('p', 'email-empty is-err', err instanceof Error ? err.message : 'Summary load failed'),
    );
  }
}

