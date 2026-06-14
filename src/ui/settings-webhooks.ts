/**
 * Settings → Webhooks — outgoing HMAC-signed event subscriptions.
 */

import { detectConfigServer, isServerStorageMode } from '../config/storage-mode';
import { appendSettingsGroup } from './settings-layout';
import { createSettingsToggleRow } from './settings-switch';
import { setStatus } from './status';

/** Events users can subscribe to (mirrors server/webhooks/constants.js). */
const SUBSCRIBABLE_EVENTS = [
  'chat.completed',
  'session.created',
  'scheduler.job_completed',
] as const;

/** Public subscription shape from the API (no secret material). */
export interface WebhookSubscriptionSummary {
  id: string;
  label: string;
  url: string;
  events: string[];
  enabled: boolean;
  hasSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliverySummary {
  id: string;
  subscriptionId: string;
  event: string;
  statusCode?: number;
  error?: string;
  durationMs: number;
  attemptedAt: string;
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

function serverBanner(message: string): HTMLElement {
  const p = el('p', 'settings-server-banner');
  p.setAttribute('role', 'status');
  p.innerHTML = message;
  return p;
}

async function fetchSubscriptions(): Promise<WebhookSubscriptionSummary[]> {
  const res = await fetch('/api/webhooks/subscriptions');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { subscriptions?: WebhookSubscriptionSummary[] };
  return Array.isArray(data.subscriptions) ? data.subscriptions : [];
}

async function fetchDeliveries(): Promise<WebhookDeliverySummary[]> {
  const res = await fetch('/api/webhooks/deliveries');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { deliveries?: WebhookDeliverySummary[] };
  return Array.isArray(data.deliveries) ? data.deliveries : [];
}

/**
 * Render webhook subscription management into the settings mount node.
 */
export async function renderWebhooksSettingsSection(mount: HTMLElement): Promise<void> {
  mount.replaceChildren();

  if (!isServerStorageMode()) {
    mount.appendChild(
      serverBanner('Webhook settings require <code>npm start</code> (server storage on disk).'),
    );
    return;
  }

  const mode = await detectConfigServer();
  if (mode !== 'server') {
    mount.appendChild(
      serverBanner('Connect with <code>npm start</code> to manage outgoing webhooks.'),
    );
    return;
  }

  mount.appendChild(
    el(
      'p',
      'settings-lead',
      'Fire HMAC-signed JSON POSTs when chats complete or new sessions are created. Secrets are encrypted at rest; payloads never include prompt text.',
    ),
  );

  const listMount = el('div', 'settings-webhooks-list');
  const formMount = el('div', 'settings-webhooks-form');
  const deliveriesMount = el('div', 'settings-webhooks-deliveries');

  mount.append(listMount, formMount, deliveriesMount);

  const refresh = async (): Promise<void> => {
    await renderSubscriptionList(listMount, refresh);
    renderAddForm(formMount, refresh);
    await renderDeliveriesTable(deliveriesMount);
  };

  await refresh();
}

async function renderSubscriptionList(
  mount: HTMLElement,
  onChange: () => Promise<void>,
): Promise<void> {
  mount.replaceChildren();
  const groupBody = appendSettingsGroup(
    mount,
    'Subscriptions',
    'HTTPS endpoints only (optional local http when config.webhooks.allowLocalHttp is true).',
    'webhooks subscriptions',
  );

  let subscriptions: WebhookSubscriptionSummary[] = [];
  try {
    subscriptions = await fetchSubscriptions();
  } catch {
    groupBody.appendChild(el('p', 'settings-field-hint', 'Could not load subscriptions.'));
    return;
  }

  if (subscriptions.length === 0) {
    groupBody.appendChild(el('p', 'settings-field-hint', 'No webhook subscriptions yet.'));
    return;
  }

  const list = el('div', 'settings-mcp-list');
  list.setAttribute('role', 'list');

  for (const sub of subscriptions) {
    const row = el('article', 'settings-mcp-row');
    row.setAttribute('role', 'listitem');

    const head = el('div', 'settings-mcp-row-head');
    head.append(el('span', 'settings-mcp-name', sub.label));
    if (sub.hasSecret) {
      head.append(el('span', 'settings-mcp-badge', 'Signed'));
    }
    row.append(head);

    const detail = el('div', 'settings-mcp-detail');
    detail.append(el('p', 'settings-mcp-desc', sub.url));
    detail.append(
      el('p', 'settings-mcp-hint', `Events: ${sub.events.join(', ') || 'none'}`),
    );

    const { row: enabledRow, input: enabledCb } = createSettingsToggleRow('Enabled', {
      checked: sub.enabled,
    });
    enabledCb.addEventListener('change', () => {
      void (async () => {
        try {
          const res = await fetch(`/api/webhooks/subscriptions/${sub.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: enabledCb.checked }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setStatus('ok', 'Webhook subscription updated');
          await onChange();
        } catch {
          enabledCb.checked = !enabledCb.checked;
          setStatus('err', 'Could not update subscription');
        }
      })();
    });
    detail.append(enabledRow);

    const actions = el('div', 'settings-server-actions');
    const testBtn = el('button', 'settings-inline-btn', 'Test fire');
    testBtn.type = 'button';
    testBtn.addEventListener('click', () => {
      void (async () => {
        try {
          const res = await fetch(`/api/webhooks/subscriptions/${sub.id}/test`, {
            method: 'POST',
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setStatus('ok', 'Test webhook queued');
          await onChange();
        } catch {
          setStatus('err', 'Test fire failed');
        }
      })();
    });

    const deleteBtn = el('button', 'settings-inline-btn settings-inline-btn--danger', 'Delete');
    deleteBtn.type = 'button';
    deleteBtn.addEventListener('click', () => {
      if (!window.confirm(`Delete webhook "${sub.label}"?`)) return;
      void (async () => {
        try {
          const res = await fetch(`/api/webhooks/subscriptions/${sub.id}`, {
            method: 'DELETE',
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setStatus('ok', 'Webhook deleted');
          await onChange();
        } catch {
          setStatus('err', 'Could not delete subscription');
        }
      })();
    });

    actions.append(testBtn, deleteBtn);
    detail.append(actions);
    row.append(detail);
    list.append(row);
  }

  groupBody.appendChild(list);
}

function renderAddForm(mount: HTMLElement, onSaved: () => Promise<void>): void {
  mount.replaceChildren();
  const groupBody = appendSettingsGroup(
    mount,
    'Add subscription',
    'Signing secret is optional but recommended for receiver verification.',
    'webhooks add',
  );

  const form = el('form', 'settings-mcp-form');
  form.noValidate = true;

  const labelField = el('div', 'field');
  labelField.append(el('label', undefined, 'Label'));
  const labelInput = el('input') as HTMLInputElement;
  labelInput.required = true;
  labelInput.autocomplete = 'off';
  labelField.appendChild(labelInput);

  const urlField = el('div', 'field');
  urlField.append(el('label', undefined, 'HTTPS URL'));
  const urlInput = el('input') as HTMLInputElement;
  urlInput.type = 'url';
  urlInput.required = true;
  urlInput.placeholder = 'https://example.com/hooks/minnow';
  urlField.appendChild(urlInput);

  const secretField = el('div', 'field');
  secretField.append(el('label', undefined, 'Signing secret (optional)'));
  const secretInput = el('input') as HTMLInputElement;
  secretInput.type = 'password';
  secretInput.autocomplete = 'new-password';
  secretField.appendChild(secretInput);

  const eventsField = el('div', 'field settings-webhooks-events');
  eventsField.append(el('label', undefined, 'Events'));
  const eventChecks: HTMLInputElement[] = [];
  for (const eventName of SUBSCRIBABLE_EVENTS) {
    const row = el('label', 'settings-checkbox-row');
    const cb = el('input') as HTMLInputElement;
    cb.type = 'checkbox';
    cb.value = eventName;
    if (eventName === 'chat.completed') cb.checked = true;
    eventChecks.push(cb);
    row.append(cb, document.createTextNode(` ${eventName}`));
    eventsField.append(row);
  }

  const errorEl = el('p', 'settings-mcp-form-error hidden');
  errorEl.setAttribute('role', 'alert');

  const submitBtn = el('button', 'settings-action-btn', 'Add subscription');
  submitBtn.type = 'submit';

  form.append(labelField, urlField, secretField, eventsField, errorEl, submitBtn);
  groupBody.appendChild(form);

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    errorEl.classList.add('hidden');
    const events = eventChecks.filter((cb) => cb.checked).map((cb) => cb.value);
    if (events.length === 0) {
      errorEl.textContent = 'Select at least one event.';
      errorEl.classList.remove('hidden');
      return;
    }
    void (async () => {
      try {
        const res = await fetch('/api/webhooks/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: labelInput.value.trim(),
            url: urlInput.value.trim(),
            secret: secretInput.value,
            events,
          }),
        });
        const payload = (await res.json()) as { error?: string };
        if (!res.ok) {
          throw new Error(payload.error || `HTTP ${res.status}`);
        }
        labelInput.value = '';
        urlInput.value = '';
        secretInput.value = '';
        setStatus('ok', 'Webhook subscription added');
        await onSaved();
      } catch (err) {
        errorEl.textContent = err instanceof Error ? err.message : 'Could not save subscription';
        errorEl.classList.remove('hidden');
      }
    })();
  });
}

async function renderDeliveriesTable(mount: HTMLElement): Promise<void> {
  mount.replaceChildren();
  const groupBody = appendSettingsGroup(
    mount,
    'Recent deliveries',
    'Last 100 attempts (errors are redacted).',
    'webhooks deliveries',
  );

  let deliveries: WebhookDeliverySummary[] = [];
  try {
    deliveries = await fetchDeliveries();
  } catch {
    groupBody.appendChild(el('p', 'settings-field-hint', 'Could not load delivery log.'));
    return;
  }

  if (deliveries.length === 0) {
    groupBody.appendChild(el('p', 'settings-field-hint', 'No deliveries yet.'));
    return;
  }

  const table = el('table', 'settings-webhooks-table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const heading of ['Time', 'Event', 'Status', 'Duration', 'Error']) {
    headRow.appendChild(el('th', undefined, heading));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const entry of deliveries.slice(0, 50)) {
    const tr = el('tr');
    const time = new Date(entry.attemptedAt).toLocaleString();
    const status =
      typeof entry.statusCode === 'number' ? String(entry.statusCode) : '—';
    tr.append(
      el('td', undefined, time),
      el('td', undefined, entry.event),
      el('td', undefined, status),
      el('td', undefined, `${entry.durationMs} ms`),
      el('td', undefined, entry.error ?? ''),
    );
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  groupBody.appendChild(table);
}
