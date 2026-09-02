/**
 * S7 — Email account setup (IMAP).
 */

import {
  createEmailAccount,
  fetchEmailAccounts,
  testEmailAccount,
} from '../../email/client';
import { isAppEnabled } from '../../os/app-preferences';
import { createStatusPill, el, renderStepHeader } from '../ui-helpers';
import type { OnboardingStep } from '../types';
import { recordStepProgress } from '../state-core';

type EmailPreset = 'gmail' | 'outlook' | 'fastmail' | 'custom';

const PRESETS: Record<EmailPreset, { label: string; imapHost: string; imapPort: number }> = {
  gmail: { label: 'Gmail', imapHost: 'imap.gmail.com', imapPort: 993 },
  outlook: { label: 'Outlook', imapHost: 'outlook.office365.com', imapPort: 993 },
  fastmail: { label: 'Fastmail', imapHost: 'imap.fastmail.com', imapPort: 993 },
  custom: { label: 'Custom', imapHost: '', imapPort: 993 },
};

let preset: EmailPreset = 'gmail';
let label = 'Personal';
let username = '';
let password = '';
let imapHost = PRESETS.gmail.imapHost;
let imapPort = 993;
let connectionOk = false;
let connectionError = '';
let savedAccountId = '';

const GMAIL_APP_PASSWORD_URL = 'https://myaccount.google.com/apppasswords';

/** Gmail requires app passwords for IMAP; link users to Google's setup page. */
function appendGmailAppPasswordNotice(container: HTMLElement): void {
  const notice = el('p', 'mn-onboarding-notice');
  notice.appendChild(
    document.createTextNode(
      'Gmail accounts must use an App Password now — your regular Google password will not work for IMAP. ',
    ),
  );
  const link = el('a', 'mn-onboarding-settings-link') as HTMLAnchorElement;
  link.href = GMAIL_APP_PASSWORD_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Create an App Password';
  notice.appendChild(link);
  notice.appendChild(document.createTextNode('.'));
  container.appendChild(notice);
}

export const emailStep: OnboardingStep = {
  id: 'email',
  title: 'Email',
  canSkip: true,
  isApplicable: (ctx) => ctx.serverAvailable && isAppEnabled('email'),

  render(container, _ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step';
    renderStepHeader(container, emailStep, actions.stepIndex, actions.totalSteps);

    container.appendChild(
      el(
        'p',
        'mn-onboarding-step-desc',
        'Connect a read-only IMAP inbox for triage and drafts. Nothing sends without you clicking send.',
      ),
    );

    const chipRow = el('div', 'mn-onboarding-chip-row');
    (Object.keys(PRESETS) as EmailPreset[]).forEach((key) => {
      const chip = el('button', 'mn-onboarding-wallpaper-chip', PRESETS[key].label);
      chip.type = 'button';
      if (key === preset) chip.classList.add('is-selected');
      chip.addEventListener('click', () => {
        preset = key;
        if (key !== 'custom') {
          imapHost = PRESETS[key].imapHost;
          imapPort = PRESETS[key].imapPort;
        }
        emailStep.render(container, _ctx, actions);
      });
      chipRow.appendChild(chip);
    });
    container.appendChild(chipRow);

    const form = el('div', 'mn-onboarding-form-grid');

    const statusPill = createStatusPill(
      connectionOk ? 'ok' : connectionError ? 'err' : 'pending',
      connectionOk ? 'Connected' : connectionError || 'Not tested',
    );

    const resetConnectionState = () => {
      connectionOk = false;
      connectionError = '';
      statusPill.className = 'mn-onboarding-status mn-onboarding-status--pending';
      statusPill.textContent = 'Not tested';
      testBtn.textContent = 'Test and save';
      actions.setPrimaryEnabled(false);
    };

    const addField = (id: string, fieldLabel: string, value: string, type = 'text') => {
      const wrap = el('label', 'mn-onboarding-field-label');
      wrap.htmlFor = id;
      wrap.appendChild(el('span', undefined, fieldLabel));
      const input = el('input', 'mn-onboarding-field') as HTMLInputElement;
      input.id = id;
      input.type = type;
      input.value = value;
      input.autocomplete = type === 'password' ? 'off' : 'email';
      input.addEventListener('input', resetConnectionState);
      wrap.appendChild(input);
      form.appendChild(wrap);
      return input;
    };

    const labelInput = addField('onbEmailLabel', 'Account label', label);
    const userInput = addField('onbEmailUser', 'Email address', username);
    const passInput = addField('onbEmailPass', 'App password', password, 'password');
    const hostInput = addField('onbEmailHost', 'IMAP host', imapHost);
    hostInput.disabled = preset !== 'custom';
    const portInput = addField('onbEmailPort', 'IMAP port', String(imapPort));
    portInput.type = 'number';

    container.appendChild(form);

    if (preset === 'gmail') {
      appendGmailAppPasswordNotice(container);
    } else if (preset === 'outlook') {
      container.appendChild(
        el('p', 'mn-onboarding-muted', 'Use an app-specific password for Outlook.'),
      );
    }

    const testBtn = el(
      'button',
      'mn-onboarding-secondary-btn',
      connectionOk ? 'Connected' : 'Test and save',
    );
    testBtn.type = 'button';
    testBtn.addEventListener('click', () => {
      label = labelInput.value.trim() || 'Personal';
      username = userInput.value.trim();
      password = passInput.value;
      imapHost = hostInput.value.trim();
      imapPort = Number(portInput.value) || 993;
      connectionOk = false;
      connectionError = '';
      testBtn.disabled = true;
      testBtn.textContent = 'Testing…';
      statusPill.className = 'mn-onboarding-status mn-onboarding-status--pending';
      statusPill.textContent = 'Testing…';

      void (async () => {
        try {
          const existing = await fetchEmailAccounts();
          const account = await createEmailAccount({
            label,
            username,
            password,
            isDefault: existing.length === 0,
            pollingEnabled: true,
            pollingIntervalMinutes: 15,
            folders: ['INBOX'],
            imap: { host: imapHost, port: imapPort, tls: true },
          });
          const test = await testEmailAccount(account.id);
          if (!test.ok) throw new Error('IMAP login failed');
          savedAccountId = account.id;
          connectionOk = true;
          statusPill.className = 'mn-onboarding-status mn-onboarding-status--ok';
          statusPill.textContent = 'Connected';
          testBtn.textContent = 'Connected';
          actions.setPrimaryEnabled(true);
        } catch (err) {
          connectionError = err instanceof Error ? err.message : 'Connection failed';
          statusPill.className = 'mn-onboarding-status mn-onboarding-status--err';
          statusPill.textContent = connectionError;
          testBtn.textContent = 'Retry';
        } finally {
          testBtn.disabled = false;
        }
      })();
    });
    container.appendChild(testBtn);

    const statusRow = el('div', 'mn-onboarding-status-row');
    statusRow.appendChild(statusPill);
    container.appendChild(statusRow);

    actions.setPrimaryLabel('Continue');
    actions.setPrimaryEnabled(connectionOk);
  },

  commit(ctx) {
    ctx.state = recordStepProgress(ctx.state, 'email', {
      done: connectionOk,
      skipped: !connectionOk,
      data: { accountId: savedAccountId || undefined },
    });
  },
};

export function resetEmailStepState(): void {
  preset = 'gmail';
  label = 'Personal';
  username = '';
  password = '';
  imapHost = PRESETS.gmail.imapHost;
  imapPort = 993;
  connectionOk = false;
  connectionError = '';
  savedAccountId = '';
}
