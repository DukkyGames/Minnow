/**
 * S8 — Calendar setup (local + optional CalDAV).
 */

import {
  createCalDavAccount,
  createCalendar,
  fetchCalDavAccounts,
  fetchCalendars,
  syncCalDav,
} from '../../calendar/client';
import { el, renderStepHeader } from '../ui-helpers';
import type { OnboardingStep } from '../types';
import { recordStepProgress } from '../state-core';

let mode: 'local' | 'caldav' = 'local';
let caldavLabel = 'Work';
let caldavUrl = '';
let caldavUser = '';
let caldavPass = '';
let setupDone = false;
let savedCalendarId = '';
let savedCalDavId = '';

export const calendarStep: OnboardingStep = {
  id: 'calendar',
  title: 'Calendar',
  canSkip: true,
  isApplicable: (ctx) => ctx.serverAvailable,

  render(container, _ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step';
    renderStepHeader(container, calendarStep, actions.stepIndex, actions.totalSteps);

    container.appendChild(
      el(
        'p',
        'mn-onboarding-step-desc',
        'Start with a local Minnow calendar or sync CalDAV from Google, Fastmail, or iCloud.',
      ),
    );

    const modeRow = el('div', 'mn-onboarding-chip-row');
    const localChip = el('button', 'mn-onboarding-wallpaper-chip', 'Local calendar');
    localChip.type = 'button';
    const caldavChip = el('button', 'mn-onboarding-wallpaper-chip', 'CalDAV sync');
    caldavChip.type = 'button';
    if (mode === 'local') localChip.classList.add('is-selected');
    else caldavChip.classList.add('is-selected');
    localChip.addEventListener('click', () => {
      mode = 'local';
      calendarStep.render(container, _ctx, actions);
    });
    caldavChip.addEventListener('click', () => {
      mode = 'caldav';
      calendarStep.render(container, _ctx, actions);
    });
    modeRow.append(localChip, caldavChip);
    container.appendChild(modeRow);

    const form = el('div', 'mn-onboarding-form-grid');

    if (mode === 'local') {
      form.appendChild(
        el(
          'p',
          'mn-onboarding-muted',
          'Creates a default calendar for agent scheduling and the Calendar app.',
        ),
      );
      const createBtn = el('button', 'mn-onboarding-secondary-btn', 'Create local calendar');
      createBtn.type = 'button';
      createBtn.addEventListener('click', () => {
        createBtn.disabled = true;
        void (async () => {
          try {
            const existing = await fetchCalendars();
            if (existing.length) {
              setupDone = true;
              savedCalendarId = existing[0].id;
            } else {
              const cal = await createCalendar({ name: 'Personal', color: '#3b82f6' });
              savedCalendarId = cal.id;
              setupDone = true;
            }
            actions.setPrimaryEnabled(true);
            createBtn.textContent = 'Created';
          } catch (err) {
            createBtn.textContent = 'Retry';
            form.appendChild(
              el(
                'p',
                'mn-onboarding-notice',
                err instanceof Error ? err.message : 'Could not create calendar',
              ),
            );
          } finally {
            createBtn.disabled = false;
          }
        })();
      });
      form.appendChild(createBtn);
    } else {
      const addField = (id: string, fieldLabel: string, value: string, type = 'text') => {
        const wrap = el('label', 'mn-onboarding-field-label');
        wrap.htmlFor = id;
        wrap.appendChild(el('span', null, fieldLabel));
        const input = el('input', 'mn-onboarding-field') as HTMLInputElement;
        input.id = id;
        input.type = type;
        input.value = value;
        input.autocomplete = type === 'password' ? 'off' : 'on';
        wrap.appendChild(input);
        form.appendChild(wrap);
        return input;
      };

      const labelInput = addField('onbCalLabel', 'Account label', caldavLabel);
      const urlInput = addField('onbCalUrl', 'CalDAV URL', caldavUrl);
      urlInput.placeholder = 'https://caldav.fastmail.com/dav/calendars/user/email@';
      const userInput = addField('onbCalUser', 'Username', caldavUser);
      const passInput = addField('onbCalPass', 'Password', caldavPass, 'password');

      const saveBtn = el('button', 'mn-onboarding-secondary-btn', 'Connect and sync');
      saveBtn.type = 'button';
      saveBtn.addEventListener('click', () => {
        caldavLabel = labelInput.value.trim() || 'CalDAV';
        caldavUrl = urlInput.value.trim();
        caldavUser = userInput.value.trim();
        caldavPass = passInput.value;
        saveBtn.disabled = true;
        void (async () => {
          try {
            const account = await createCalDavAccount({
              label: caldavLabel,
              url: caldavUrl,
              username: caldavUser,
              password: caldavPass,
            });
            savedCalDavId = account.id;
            await syncCalDav(account.id);
            setupDone = true;
            actions.setPrimaryEnabled(true);
            saveBtn.textContent = 'Connected';
          } catch (err) {
            form.appendChild(
              el(
                'p',
                'mn-onboarding-notice',
                err instanceof Error ? err.message : 'CalDAV connection failed',
              ),
            );
            saveBtn.textContent = 'Retry';
          } finally {
            saveBtn.disabled = false;
          }
        })();
      });
      form.appendChild(saveBtn);
    }

    container.appendChild(form);

    void fetchCalDavAccounts().then((accounts) => {
      if (accounts.length) {
        setupDone = true;
        savedCalDavId = accounts[0].id;
        actions.setPrimaryEnabled(true);
      }
    });

    actions.setPrimaryLabel('Continue');
    actions.setPrimaryEnabled(setupDone);
  },

  commit(ctx) {
    ctx.state = recordStepProgress(ctx.state, 'calendar', {
      done: setupDone,
      skipped: !setupDone,
      data: { calendarId: savedCalendarId, caldavId: savedCalDavId, mode },
    });
  },
};

export function resetCalendarStepState(): void {
  mode = 'local';
  setupDone = false;
  savedCalendarId = '';
  savedCalDavId = '';
}
