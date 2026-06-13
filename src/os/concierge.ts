import { resolveConciergePlan } from './concierge-agent';
import { getAppById } from './app-registry';
import { CONCIERGE_LINES } from './intent-routing';
import { MINNOW_GLYPH_HEADER_HTML } from '../ui/minnow-glyph';
import { createOsIcon } from './icons';
import type { AppId, LaunchOptions } from './types';

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
  onLaunch: (appId: AppId, options: LaunchOptions) => void,
): void {
  container.replaceChildren();
  container.className = 'mn-os-concierge';

  let phase: ConciergePhase = 'idle';
  let lineText = '';
  let whimsicalTimer: ReturnType<typeof setTimeout> | undefined;

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

  function clearWhimsicalTimer(): void {
    if (whimsicalTimer !== undefined) {
      clearTimeout(whimsicalTimer);
      whimsicalTimer = undefined;
    }
  }

  function syncUi(): void {
    inputWrap.classList.toggle('is-busy', phase !== 'idle');
    field.disabled = phase !== 'idle';
    sendBtn.disabled = !field.value.trim() || phase !== 'idle';
    status.classList.toggle('is-visible', phase !== 'idle');
    statusLine.textContent = lineText;
    chipsWrap.hidden = phase !== 'idle';
  }

  function showWhimsicalLine(): void {
    const pick = CONCIERGE_LINES[Math.floor(Math.random() * CONCIERGE_LINES.length)];
    lineText = pick ?? 'Understanding your request…';
    syncUi();
  }

  async function submit(text?: string): Promise<void> {
    const q = (text ?? field.value).trim();
    if (!q || phase === 'thinking') return;

    phase = 'thinking';
    clearWhimsicalTimer();
    lineText = 'Understanding your request…';
    syncUi();
    showWhimsicalLine();
    whimsicalTimer = setTimeout(showWhimsicalLine, 900);

    try {
      const plan = await resolveConciergePlan(q);
      const app = getAppById(plan.appId);
      clearWhimsicalTimer();
      lineText = app ? `Opening ${app.name}…` : 'Opening app…';
      phase = 'done';
      syncUi();

      const { appId, ...options } = plan;
      onLaunch(appId, options);
      field.value = '';
    } catch {
      clearWhimsicalTimer();
      lineText = 'Could not plan — opening Chat…';
      phase = 'done';
      syncUi();
      onLaunch('chat', { seed: q });
      field.value = '';
    } finally {
      phase = 'idle';
      lineText = '';
      clearWhimsicalTimer();
      syncUi();
    }
  }

  field.addEventListener('input', () => syncUi());
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void submit();
  });
  sendBtn.addEventListener('click', () => void submit());

  for (const label of CONCIERGE_CHIPS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mn-os-cc-chip';
    chip.textContent = label;
    chip.addEventListener('click', () => {
      field.value = label;
      syncUi();
      void submit(label);
    });
    chipsWrap.appendChild(chip);
  }

  container.append(inputWrap, status, chipsWrap);
  syncUi();
}
