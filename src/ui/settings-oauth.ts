/**
 * Settings → Integrations → OAuth — BYO Google / Microsoft app credentials.
 */

import { detectConfigServer, isServerStorageMode } from '../config/storage-mode';
import { loadOAuthSettings, saveOAuthSettings } from '../config/oauth-meta';
import { appendSettingsGroup } from './settings-layout';
import { setStatus } from './status';

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

/** Render OAuth credential form into the settings mount node. */
export async function renderOAuthSettingsSection(mount: HTMLElement): Promise<void> {
  mount.replaceChildren();

  if (!isServerStorageMode()) {
    mount.appendChild(
      serverBanner('OAuth settings require <code>npm start</code> (server storage on disk).'),
    );
    return;
  }

  const mode = await detectConfigServer();
  if (mode !== 'server') {
    mount.appendChild(
      serverBanner('Connect with <code>npm start</code> to configure OAuth integrations.'),
    );
    return;
  }

  mount.appendChild(
    el(
      'p',
      'settings-lead',
      'Register your own Google Cloud and Azure apps so Email and Calendar can use Sign in with Google / Microsoft. Tokens are encrypted locally; secrets are never sent to the browser after save.',
    ),
  );

  const settings = await loadOAuthSettings();
  const redirectRow = el('p', 'settings-section-note');
  redirectRow.innerHTML = settings.redirectUri
    ? `Redirect URI (register in your OAuth app): <code>${settings.redirectUri}</code>`
    : 'Start the dev server to see the OAuth redirect URI.';
  mount.appendChild(redirectRow);

  const docs = el('p', 'settings-section-note');
  docs.textContent =
    'Setup guides: documentation/guides/oauth-google.md and documentation/guides/oauth-microsoft.md in the repo.';
  mount.appendChild(docs);

  const form = el('form', 'settings-oauth-form');
  mount.appendChild(form);

  const googleGroup = appendSettingsGroup(form, 'Google');
  const googleClientId = el('input', 'settings-input') as HTMLInputElement;
  googleClientId.id = 'oauth-google-client-id';
  googleClientId.value = settings.google.clientId;
  googleClientId.autocomplete = 'off';
  googleGroup.appendChild(el('label', 'settings-label', 'Client ID'));
  googleGroup.appendChild(googleClientId);

  const googleSecret = el('input', 'settings-input') as HTMLInputElement;
  googleSecret.type = 'password';
  googleSecret.id = 'oauth-google-client-secret';
  googleSecret.placeholder = settings.google.hasClientSecret ? '(unchanged)' : '';
  googleSecret.autocomplete = 'new-password';
  googleGroup.appendChild(el('label', 'settings-label', 'Client secret'));
  googleGroup.appendChild(googleSecret);

  const msGroup = appendSettingsGroup(form, 'Microsoft');
  const msClientId = el('input', 'settings-input') as HTMLInputElement;
  msClientId.id = 'oauth-microsoft-client-id';
  msClientId.value = settings.microsoft.clientId;
  msGroup.appendChild(el('label', 'settings-label', 'Application (client) ID'));
  msGroup.appendChild(msClientId);

  const msTenant = el('input', 'settings-input') as HTMLInputElement;
  msTenant.id = 'oauth-microsoft-tenant-id';
  msTenant.value = settings.microsoft.tenantId;
  msTenant.placeholder = 'common';
  msGroup.appendChild(el('label', 'settings-label', 'Tenant ID'));
  msGroup.appendChild(msTenant);

  const msSecret = el('input', 'settings-input') as HTMLInputElement;
  msSecret.type = 'password';
  msSecret.id = 'oauth-microsoft-client-secret';
  msSecret.placeholder = settings.microsoft.hasClientSecret ? '(unchanged)' : '';
  msSecret.autocomplete = 'new-password';
  msGroup.appendChild(el('label', 'settings-label', 'Client secret'));
  msGroup.appendChild(msSecret);

  const actions = el('div', 'settings-form-actions');
  const saveBtn = el(
    'button',
    'settings-action-btn settings-action-btn--primary',
    'Save OAuth credentials',
  ) as HTMLButtonElement;
  saveBtn.type = 'submit';
  actions.appendChild(saveBtn);
  form.appendChild(actions);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    saveBtn.disabled = true;
    try {
      const patch: Parameters<typeof saveOAuthSettings>[0] = {
        google: { clientId: googleClientId.value.trim() },
        microsoft: {
          clientId: msClientId.value.trim(),
          tenantId: msTenant.value.trim() || 'common',
        },
      };
      if (googleSecret.value.trim()) {
        patch.google!.clientSecret = googleSecret.value.trim();
      }
      if (msSecret.value.trim()) {
        patch.microsoft!.clientSecret = msSecret.value.trim();
      }
      await saveOAuthSettings(patch);
      googleSecret.value = '';
      msSecret.value = '';
      setStatus('ok', 'OAuth credentials saved');
    } catch (err) {
      setStatus('err', err instanceof Error ? err.message : String(err));
    } finally {
      saveBtn.disabled = false;
    }
  });
}
