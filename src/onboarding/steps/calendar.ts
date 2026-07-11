/**
 * S8 — Calendar setup (local + optional iCal link import).
 */

import {
  createCalendar,
  fetchCalendars,
  importIcsFromUrl,
} from '../../calendar/client';
import { el, renderStepHeader } from '../ui-helpers';
import type { OnboardingStep } from '../types';
import { recordStepProgress } from '../state-core';

let mode: 'local' | 'ics' = 'local';
let icsLabel = 'Personal';
let icsUrl = '';
let setupDone = false;
let savedCalendarId = '';

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
        'Start with a local Minnow calendar or import events from a read-only iCal link (Google, iCloud, Fastmail, etc.).',
      ),
    );

    const modeRow = el('div', 'mn-onboarding-chip-row');
    const localChip = el('button', 'mn-onboarding-wallpaper-chip', 'Local calendar');
    localChip.type = 'button';
    const icsChip = el('button', 'mn-onboarding-wallpaper-chip', 'iCal link');
    icsChip.type = 'button';
    if (mode === 'local') localChip.classList.add('is-selected');
    else icsChip.classList.add('is-selected');
    localChip.addEventListener('click', () => {
      mode = 'local';
      calendarStep.render(container, _ctx, actions);
    });
    icsChip.addEventListener('click', () => {
      mode = 'ics';
      calendarStep.render(container, _ctx, actions);
    });
    modeRow.append(localChip, icsChip);
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
        input.autocomplete = 'off';
        wrap.appendChild(input);
        form.appendChild(wrap);
        return input;
      };

      form.appendChild(
        el(
          'p',
          'mn-onboarding-muted',
          'Paste the secret iCal URL from your calendar provider. Google: Settings → your calendar → Integrate calendar → Secret address in iCal format.',
        ),
      );

      const labelInput = addField('onbCalLabel', 'Calendar name', icsLabel);
      const urlInput = addField('onbCalUrl', 'iCal URL', icsUrl);
      urlInput.placeholder = 'https://calendar.google.com/calendar/ical/.../basic.ics';

      const importBtn = el('button', 'mn-onboarding-secondary-btn', 'Import calendar');
      importBtn.type = 'button';
      importBtn.addEventListener('click', () => {
        icsLabel = labelInput.value.trim() || 'Imported calendar';
        icsUrl = urlInput.value.trim();
        importBtn.disabled = true;
        void (async () => {
          try {
            const result = await importIcsFromUrl({
              url: icsUrl,
              calendarName: icsLabel,
            });
            savedCalendarId = result.calendarId;
            setupDone = true;
            actions.setPrimaryEnabled(true);
            importBtn.textContent = `Imported ${result.imported} event${result.imported === 1 ? '' : 's'}`;
          } catch (err) {
            form.appendChild(
              el(
                'p',
                'mn-onboarding-notice',
                err instanceof Error ? err.message : 'iCal import failed',
              ),
            );
            importBtn.textContent = 'Retry';
          } finally {
            importBtn.disabled = false;
          }
        })();
      });
      form.appendChild(importBtn);
    }

    container.appendChild(form);

    void fetchCalendars().then((calendars) => {
      if (calendars.length) {
        setupDone = true;
        savedCalendarId = calendars[0].id;
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
      data: { calendarId: savedCalendarId, mode },
    });
  },
};

export function resetCalendarStepState(): void {
  mode = 'local';
  icsLabel = 'Personal';
  icsUrl = '';
  setupDone = false;
  savedCalendarId = '';
}
