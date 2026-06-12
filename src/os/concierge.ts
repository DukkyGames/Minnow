import { getAppById } from './app-registry';
import { CONCIERGE_LINES, routeIntent } from './intent-routing';
import { MINNOW_GLYPH_HEADER_HTML } from '../ui/minnow-glyph';
import { createOsIcon } from './icons';
import type { AppId } from './types';

const CONCIERGE_CHIPS = [
  'Build a feature',
  'Research a topic',
  'Benchmark two models',
  'Adjust my theme',
] as const;

type ConciergePhase = 'idle' | 'thinking' | 'done';

/** Render the desktop concierge input + chips. */
export function renderConcierge(
  container: HTMLElement,
  onLaunch: (appId: AppId, seed: string) => void,
): void {
  container.replaceChildren();
  container.className = 'mn-os-concierge';

  let phase: ConciergePhase = 'idle';
  let lineText = '';
  const timers: ReturnType<typeof setTimeout>[] = [];

  const inputWrap = document.createElement('div');
  inputWrap.className = 'mn-os-cc-input';

  const fish = document.createElement('div');
  fish.className = 'mn-os-cc-fish';
  fish.innerHTML = MINNOW_GLYPH_HEADER_HTML;
  inputWrap.appendChild(fish);

  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'mn-os-cc-field';
  field.placeholder = 'What would you like to do today?';
  field.autocomplete = 'off';
  field.spellcheck = false;
  inputWrap.appendChild(field);

  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'mn-os-cc-send';
  sendBtn.setAttribute('aria-label', 'Send');
  sendBtn.appendChild(createOsIcon('arrowUp', { size: 18 }));
  inputWrap.appendChild(sendBtn);

  const status = document.createElement('div');
  status.className = 'mn-os-cc-status';

  const statusDot = document.createElement('span');
  statusDot.className = 'mn-os-cc-dot';
  const statusLine = document.createElement('span');
  statusLine.className = 'mn-os-mono';
  status.appendChild(statusDot);
  status.appendChild(statusLine);

  const chipsWrap = document.createElement('div');
  chipsWrap.className = 'mn-os-cc-chips';

  function clearTimers(): void {
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
  }

  function syncUi(): void {
    inputWrap.classList.toggle('is-busy', phase !== 'idle');
    field.disabled = phase !== 'idle';
    sendBtn.disabled = !field.value.trim() || phase !== 'idle';
    status.classList.toggle('is-visible', phase !== 'idle');
    statusLine.textContent = lineText;
    chipsWrap.hidden = phase !== 'idle';
  }

  function submit(text?: string): void {
    const q = (text ?? field.value).trim();
    if (!q || phase === 'thinking') return;

    const appId = routeIntent(q);
    const app = getAppById(appId);
    if (!app) return;

    phase = 'thinking';
    clearTimers();
    syncUi();

    const seq = [...CONCIERGE_LINES].sort(() => Math.random() - 0.5).slice(0, 3);
    seq.forEach((l, i) => {
      timers.push(
        setTimeout(() => {
          lineText = l;
          syncUi();
        }, i * 620),
      );
    });

    const doneAt = seq.length * 620;
    timers.push(
      setTimeout(() => {
        lineText = `Opening ${app.name}…`;
        phase = 'done';
        syncUi();
      }, doneAt),
    );

    timers.push(
      setTimeout(() => {
        onLaunch(appId, q);
        field.value = '';
        phase = 'idle';
        lineText = '';
        clearTimers();
        syncUi();
      }, doneAt + 720),
    );
  }

  field.addEventListener('input', () => syncUi());
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  sendBtn.addEventListener('click', () => submit());

  for (const label of CONCIERGE_CHIPS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mn-os-cc-chip';
    chip.textContent = label;
    chip.addEventListener('click', () => {
      field.value = label;
      syncUi();
      submit(label);
    });
    chipsWrap.appendChild(chip);
  }

  container.append(inputWrap, status, chipsWrap);
  syncUi();
}
