/**
 * S7 — Email account setup (IMAP).
 */

import {
  createEmailAccount,
  fetchEmailAccounts,
  testEmailAccount,
} from '../../email/client';
import { el, renderStepHeader } from '../ui-helpers';
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

export const emailStep: OnboardingStep = {
  id: 'email',
  title: 'Email',
  canSkip: true,
  isApplicable: (ctx) => ctx.serverAvailable,

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

    const addField = (id: string, fieldLabel: string, value: string, type = 'text') => {
      const wrap = el('label', 'mn-onboarding-field-label');
      wrap.htmlFor = id;
      wrap.appendChild(el('span', null, fieldLabel));
      const input = el('input', 'mn-onboarding-field') as HTMLInputElement;
      input.id = id;
      input.type = type;
      input.value = value;
      input.autocomplete = type === 'password' ? 'off' : 'email';
      input.addEventListener('input', () => {
        connectionOk = false;
        actions.setPrimaryEnabled(false);
      });
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

    const notice = el('p', 'mn-onboarding-muted', 'Use an app-specific password for Gmail and Outlook.');
    container.appendChild(notice);

    const testBtn = el('button', 'mn-onboarding-secondary-btn', 'Test and save');
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
          actions.setPrimaryEnabled(true);
        } catch (err) {
          connectionError = err instanceof Error ? err.message : 'Connection failed';
          notice.textContent = connectionError;
          notice.className = 'mn-onboarding-notice';
        } finally {
          testBtn.disabled = false;
          testBtn.textContent = 'Test and save';
        }
      })();
    });
    container.appendChild(testBtn);

    if (connectionOk) {
      container.appendChild(el('p', 'mn-onboarding-notice is-ok', 'Email account connected.'));
    }

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
