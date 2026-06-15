import { resolveConciergePlan } from './concierge-agent';
import {
  activateDesktopChat,
  isDesktopChatActive,
  isDesktopResearchActive,
} from './desktop-state';
import { handleDesktopSend, wireDesktopComposerControls } from './desktop-chat';
import { handleDesktopResearchSubmit } from './research-desktop';
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

/** Build the full desktop composer bar (textarea, attach, voice, context ring, send). */
function buildDesktopComposer(): HTMLElement {
  const root = document.createElement('div');
  root.id = 'desktopComposerRoot';
  root.className = 'mn-os-desktop-composer';

  const attachPreview = document.createElement('div');
  attachPreview.id = 'desktopAttachPreview';
  attachPreview.className = 'attach-preview hidden';
  attachPreview.setAttribute('aria-live', 'polite');
  attachPreview.setAttribute('aria-label', 'Attached files');

  const row = document.createElement('div');
  row.className = 'mn-os-desktop-input-row';

  const attachBtn = document.createElement('button');
  attachBtn.type = 'button';
  attachBtn.id = 'btnDesktopAttach';
  attachBtn.className = 'mn-os-desktop-comp-btn';
  attachBtn.setAttribute('aria-label', 'Attach files');
  attachBtn.title = 'Attach files';
  attachBtn.innerHTML =
    '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';

  const inputWrap = document.createElement('div');
  inputWrap.className = 'mn-os-desktop-input-wrap';

  const fish = document.createElement('div');
  fish.className = 'mn-os-cc-fish';
  fish.innerHTML = MINNOW_GLYPH_HEADER_HTML;
  inputWrap.appendChild(fish);

  const field = document.createElement('textarea');
  field.id = 'desktopInput';
  field.className = 'mn-os-desktop-field';
  field.rows = 1;
  field.placeholder = 'What would you like to do today?';
  field.spellcheck = false;
  inputWrap.appendChild(field);

  const contextAnchor = document.createElement('div');
  contextAnchor.className = 'context-usage-anchor mn-os-desktop-context';
  contextAnchor.innerHTML = `
    <button
      type="button"
      class="context-usage-ring"
      id="desktopContextRing"
      aria-label="Context usage"
      aria-expanded="false"
      aria-haspopup="dialog"
      aria-controls="desktopContextBreakdown"
      title="Context window usage"
    >
      <svg class="context-usage-ring__svg" viewBox="0 0 24 24" aria-hidden="true">
        <circle class="context-usage-ring__track" cx="12" cy="12" r="10"></circle>
        <circle class="context-usage-ring__fill" cx="12" cy="12" r="10"></circle>
      </svg>
    </button>
    <div
      id="desktopContextBreakdown"
      class="context-usage-breakdown hidden"
      role="dialog"
      aria-label="Context usage breakdown"
    ></div>
  `;

  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.id = 'desktopSendBtn';
  sendBtn.className = 'mn-os-desktop-send';
  sendBtn.setAttribute('aria-label', 'Send message');
  sendBtn.appendChild(createOsIcon('arrowUp', { size: 18 }));

  row.append(attachBtn, inputWrap, contextAnchor, sendBtn);
  root.append(attachPreview, row);
  return root;
}

/** Render the desktop concierge composer + chips. */
export function renderConcierge(
  container: HTMLElement,
  onLaunch: (appId: AppId, options: LaunchOptions) => void,
): void {
  container.replaceChildren();
  container.className = 'mn-os-concierge-mount';

  let phase: ConciergePhase = 'idle';
  let lineText = '';
  let whimsicalTimer: ReturnType<typeof setTimeout> | undefined;

  const conciergeWrap = document.createElement('div');
  conciergeWrap.className = 'mn-os-concierge';

  const composer = buildDesktopComposer();
  conciergeWrap.appendChild(composer);

  const status = document.createElement('div');
  status.className = 'mn-os-cc-status';

  const statusDot = document.createElement('span');
  statusDot.className = 'mn-os-cc-dot';
  const statusLine = document.createElement('span');
  statusLine.className = 'mn-os-mono';
  status.appendChild(statusDot);
  status.appendChild(statusLine);
  conciergeWrap.appendChild(status);

  const chipsWrap = document.createElement('div');
  chipsWrap.className = 'mn-os-cc-chips';

  const field = composer.querySelector('#desktopInput') as HTMLTextAreaElement;
  const sendBtn = composer.querySelector('#desktopSendBtn') as HTMLButtonElement;

  wireDesktopComposerControls();

  function clearWhimsicalTimer(): void {
    if (whimsicalTimer !== undefined) {
      clearTimeout(whimsicalTimer);
      whimsicalTimer = undefined;
    }
  }

  function syncUi(): void {
    composer.classList.toggle('is-busy', phase !== 'idle');
    const inSurfaceMode = isDesktopChatActive() || isDesktopResearchActive();
    field.disabled = phase !== 'idle' && !inSurfaceMode;
    const hasText = Boolean(field.value.trim());
    sendBtn.disabled = (!hasText && phase === 'idle') || phase === 'thinking';
    status.classList.toggle('is-visible', phase !== 'idle');
    statusLine.textContent = lineText;
    chipsWrap.hidden = phase !== 'idle' || inSurfaceMode;
  }

  function showWhimsicalLine(): void {
    const pick = CONCIERGE_LINES[Math.floor(Math.random() * CONCIERGE_LINES.length)];
    lineText = pick ?? 'Understanding your request…';
    syncUi();
  }

  async function submit(text?: string): Promise<void> {
    const q = (text ?? field.value).trim();
    if (!q || phase === 'thinking') return;

    if (isDesktopChatActive()) {
      field.value = q;
      field.dispatchEvent(new window.Event('input', { bubbles: true }));
      await handleDesktopSend();
      field.value = '';
      syncUi();
      return;
    }

    if (isDesktopResearchActive()) {
      field.value = q;
      field.dispatchEvent(new window.Event('input', { bubbles: true }));
      await handleDesktopResearchSubmit();
      syncUi();
      return;
    }

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

      if (plan.appId === 'chat') {
        lineText = 'Starting chat…';
        phase = 'done';
        syncUi();
        const seed = plan.seed?.trim() || q;
        field.value = '';
        await activateDesktopChat({ seed });
      } else if (plan.appId === 'research') {
        lineText = 'Starting research…';
        phase = 'done';
        syncUi();
        const { appId, ...options } = plan;
        onLaunch(appId, options);
        field.value = '';
      } else {
        lineText = app ? `Opening ${app.name}…` : 'Opening app…';
        phase = 'done';
        syncUi();
        const { appId, ...options } = plan;
        onLaunch(appId, options);
        field.value = '';
      }
    } catch {
      clearWhimsicalTimer();
      lineText = 'Could not plan — starting chat…';
      phase = 'done';
      syncUi();
      field.value = '';
      await activateDesktopChat({ seed: q });
    } finally {
      phase = 'idle';
      lineText = '';
      clearWhimsicalTimer();
      syncUi();
    }
  }

  field.addEventListener('input', () => syncUi());
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
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

  conciergeWrap.appendChild(chipsWrap);
  container.appendChild(conciergeWrap);
  syncUi();
}
