/**
 * Shared OAuth connect UI — Sign in with Google / Microsoft.
 */

import {
  deleteOAuthConnection,
  fetchOAuthConnections,
  startOAuthConnect,
  waitForOAuthConnection,
  type OAuthConnection,
  type OAuthProviderId,
} from '../oauth/client';

export interface OAuthConnectOptions {
  /** Mount point for connect buttons and connection list. */
  mount: HTMLElement;
  /** Called after a successful connect or disconnect. */
  onChange?: () => void | Promise<void>;
  /** Status line callback. */
  onStatus?: (state: 'ok' | 'err', message: string) => void;
  /** Show "Also connect calendar" checkbox (default true). */
  showCalendarCheckbox?: boolean;
  /** Show "Connect with IMAP" for password/app-password providers (Email app). */
  showImapAlternative?: boolean;
  /** Reveal the IMAP setup form when the user picks manual connect. */
  onShowImap?: () => void;
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

function providerLabel(provider: OAuthProviderId): string {
  return provider === 'google' ? 'Google' : 'Microsoft';
}

/** Render OAuth connect controls into mount. */
export async function mountOAuthConnectPanel(options: OAuthConnectOptions): Promise<void> {
  const {
    mount,
    onChange,
    onStatus,
    showCalendarCheckbox = true,
    showImapAlternative = false,
    onShowImap,
  } = options;
  mount.replaceChildren();

  const panel = el('div', 'oauth-connect-panel');
  mount.appendChild(panel);

  const leadText = showImapAlternative
    ? 'Connect with OAuth for Gmail, Outlook, and calendar sync — no app passwords required. Or use IMAP for Fastmail, iCloud, and other providers.'
    : 'Connect with OAuth for Gmail, Outlook, and calendar sync — no app passwords required.';
  const lead = el('p', 'oauth-connect-lead', leadText);
  panel.appendChild(lead);

  const optionsRow = el('div', 'oauth-connect-options');
  panel.appendChild(optionsRow);

  let alsoCalendar = true;
  if (showCalendarCheckbox) {
    const checkLabel = el('label', 'oauth-connect-checkbox');
    const check = el('input') as HTMLInputElement;
    check.type = 'checkbox';
    check.checked = true;
    check.addEventListener('change', () => {
      alsoCalendar = check.checked;
    });
    checkLabel.appendChild(check);
    checkLabel.appendChild(el('span', undefined, 'Also connect calendar'));
    optionsRow.appendChild(checkLabel);
  }

  const btnRow = el('div', 'oauth-connect-actions');
  panel.appendChild(btnRow);

  const settingsHint = el(
    'p',
    'oauth-connect-hint',
    'Configure OAuth apps in Settings → OAuth before connecting.',
  );
  panel.appendChild(settingsHint);

  const listMount = el('div', 'oauth-connect-list');
  panel.appendChild(listMount);

  const setStatus = (state: 'ok' | 'err', message: string) => {
    onStatus?.(state, message);
  };

  const renderConnections = async () => {
    listMount.replaceChildren();
    let connections: OAuthConnection[] = [];
    try {
      connections = await fetchOAuthConnections();
    } catch (err) {
      listMount.appendChild(
        el('p', 'oauth-connect-error', err instanceof Error ? err.message : String(err)),
      );
      return;
    }

    if (connections.length === 0) {
      listMount.appendChild(el('p', 'oauth-connect-empty', 'No OAuth accounts connected yet.'));
      return;
    }

    for (const connection of connections) {
      const row = el('div', 'oauth-connect-row');
      const title = el(
        'span',
        'oauth-connect-row-label',
        `${connection.label} (${providerLabel(connection.provider)})`,
      );
      row.appendChild(title);
      const meta = el(
        'span',
        'oauth-connect-row-meta',
        [
          connection.email,
          connection.services.email ? 'Email' : null,
          connection.services.calendar ? 'Calendar' : null,
        ]
          .filter(Boolean)
          .join(' · '),
      );
      row.appendChild(meta);

      const disconnectBtn = el('button', 'oauth-connect-btn oauth-connect-btn--danger', 'Disconnect') as HTMLButtonElement;
      disconnectBtn.type = 'button';
      disconnectBtn.addEventListener('click', async () => {
        if (!window.confirm(`Disconnect ${connection.email}?`)) {
          return;
        }
        try {
          await deleteOAuthConnection(connection.id);
          setStatus('ok', 'Account disconnected');
          await renderConnections();
          await onChange?.();
        } catch (err) {
          setStatus('err', err instanceof Error ? err.message : String(err));
        }
      });
      row.appendChild(disconnectBtn);
      listMount.appendChild(row);
    }
  };

  const connect = async (provider: OAuthProviderId) => {
    const before = new Set((await fetchOAuthConnections()).map((row) => row.id));
    try {
      const started = await startOAuthConnect({
        provider,
        services: { email: true, calendar: alsoCalendar },
      });
      window.open(started.authUrl, '_blank', 'noopener,noreferrer');
      setStatus('ok', 'Complete sign-in in the browser tab…');
      const connection = await waitForOAuthConnection(before);
      if (!connection) {
        setStatus('err', 'Timed out waiting for OAuth — try again');
        return;
      }
      setStatus('ok', `Connected ${connection.email}`);
      await renderConnections();
      await onChange?.();
    } catch (err) {
      setStatus('err', err instanceof Error ? err.message : String(err));
    }
  };

  const googleBtn = el(
    'button',
    'oauth-connect-btn oauth-connect-btn--google',
    'Sign in with Google',
  ) as HTMLButtonElement;
  googleBtn.type = 'button';
  googleBtn.addEventListener('click', () => void connect('google'));
  btnRow.appendChild(googleBtn);

  const msBtn = el(
    'button',
    'oauth-connect-btn oauth-connect-btn--microsoft',
    'Sign in with Microsoft',
  ) as HTMLButtonElement;
  msBtn.type = 'button';
  msBtn.addEventListener('click', () => void connect('microsoft'));
  btnRow.appendChild(msBtn);

  if (showImapAlternative && onShowImap) {
    const divider = el('p', 'oauth-connect-divider', 'or');
    panel.appendChild(divider);

    const imapBtn = el(
      'button',
      'oauth-connect-btn oauth-connect-btn--imap',
      'Connect with IMAP',
    ) as HTMLButtonElement;
    imapBtn.type = 'button';
    imapBtn.addEventListener('click', () => {
      onShowImap();
    });
    panel.appendChild(imapBtn);
  }

  await renderConnections();
}
