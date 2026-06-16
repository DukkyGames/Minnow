/**
 * Inbox dashboard — digest headline, instrumentation strip, attention queue, reply chips.
 */

import type { EmailAccount, EmailInboxSummary } from '../../email/client';
import {
  fetchInboxSummary,
  regenerateReplyVariants,
  sendReplyVariant,
} from '../../email/client-ext';

export interface EmailDashboardOptions {
  account: EmailAccount;
  onStatus?: (state: 'ok' | 'err', message: string) => void;
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

/** Build quick-reply chip row for one highlight thread. */
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
  for (const variant of variants) {
    const chip = el('button', 'email-dash-variant-chip') as HTMLButtonElement;
    chip.type = 'button';
    chip.textContent = variant.label;
    chip.title = variant.body.slice(0, 120);
    chip.addEventListener('click', async () => {
      const ok = window.confirm(`Send "${variant.label}" reply to this thread?`);
      if (!ok) return;
      try {
        await sendReplyVariant({
          accountId: account.id,
          messageId: highlight.messageId,
          threadId: highlight.threadId,
          variantId: variant.id,
        });
        options.onStatus?.('ok', 'Reply sent');
      } catch (err) {
        options.onStatus?.('err', err instanceof Error ? err.message : 'Send failed');
      }
    });
    row.appendChild(chip);
  }

  const reprompt = el('button', 'email-dash-variant-reprompt', 'Reprompt') as HTMLButtonElement;
  reprompt.type = 'button';
  reprompt.addEventListener('click', async () => {
    const instructions = window.prompt('How should the reply variants change?');
    if (!instructions?.trim()) return;
    try {
      await regenerateReplyVariants({
        accountId: account.id,
        messageId: highlight.messageId,
        threadId: highlight.threadId,
        instructions: instructions.trim(),
      });
      options.onStatus?.('ok', 'Variants regenerated');
      options.onRefresh?.();
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'Reprompt failed');
    }
  });
  row.appendChild(reprompt);

  block.appendChild(row);
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

/** One attention-queue row for a triaged highlight thread. */
function renderHighlightRow(
  list: HTMLElement,
  highlight: EmailInboxSummary['highlights'][0],
  account: EmailAccount,
  options: EmailDashboardOptions,
): void {
  const row = el('article', `email-dash-row ${urgencyClass(highlight.urgency)}`);
  if (highlight.unseen) {
    row.classList.add('is-unread');
  }

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
  const badge = el('span', `email-urgency-badge ${urgencyClass(highlight.urgency)}`);
  badge.textContent = highlight.urgency;
  meta.appendChild(badge);
  main.appendChild(meta);

  main.appendChild(el('p', 'email-dash-row-summary', highlight.summary));
  row.appendChild(main);

  renderVariantChips(row, account, highlight, options);
  list.appendChild(row);
}

/**
 * Render the default inbox dashboard view.
 */
export async function renderEmailDashboard(
  mount: HTMLElement,
  options: EmailDashboardOptions,
): Promise<void> {
  mount.replaceChildren(el('p', 'email-loading', 'Loading inbox summary…'));

  try {
    const { summary } = await fetchInboxSummary(options.account.id);
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

    if (summary.text.trim()) {
      mount.appendChild(el('p', 'email-dash-brief', summary.text.trim()));
    }

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
      for (const highlight of summary.highlights) {
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
