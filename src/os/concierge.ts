import {
  activateDesktopChat,
  isDesktopChatActive,
  isDesktopResearchActive,
} from './desktop-state';
import {
  autoResizeDesktopComposer,
} from './desktop-composer-resize';
import {
  handleDesktopSend,
  wireDesktopComposerControls,
} from './desktop-chat';
import {
  shouldAllowComposerPrimaryAction,
  syncComposerFromStreamingState,
} from '../ui/composer-send';
import { isActiveChatStreaming } from '../chat/streaming-state';
import { handleSkillPickerKeydown, isSkillPickerOpen } from '../ui/skill-picker';
import { handleComposerPromptHistoryKeydown } from '../ui/composer-prompt-history';
import { iconHtml } from '../ui/icon';
import { MINNOW_GLYPH_HEADER_HTML } from '../ui/minnow-glyph';

/** Tools permissions popover for the desktop composer (mirrors Chat/Code composer popovers). */
function buildDesktopToolsAnchor(): HTMLElement {
  const anchor = document.createElement('div');
  anchor.className = 'composer-tools-anchor mn-os-desktop-tools-anchor';

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'btnDesktopTools';
  button.className = 'mn-os-desktop-comp-btn composer-tools-btn';
  button.setAttribute('aria-label', 'Tools');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', 'desktopToolsPopover');
  button.title = 'Tool permissions';
  button.innerHTML = iconHtml('settings');

  const popover = document.createElement('div');
  popover.id = 'desktopToolsPopover';
  popover.className = 'composer-tools-popover hidden';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Tool permissions');
  popover.innerHTML = `
    <header class="composer-tools-popover__header">
      <h2 class="composer-tools-popover__title">Tools</h2>
    </header>
    <div id="desktopToolsStatus" class="composer-tools-popover__status hidden" role="status" aria-live="polite">
      <p id="desktopToolsServerBanner" class="composer-tools-popover__notice hidden">Some tools need Minnow running locally. Open or restart the app.</p>
      <p id="desktopToolsPreviewBanner" class="composer-tools-popover__notice hidden">Browser tools need the Minnow desktop app window.</p>
    </div>
    <div id="desktopToolsList" class="tools-list tools-list--composer"></div>
    <footer class="composer-tools-popover__footer">
      <div class="composer-tools-popover__setting">
        <label for="desktopToolsWebSearchProvider" class="composer-tools-popover__setting-label">Web search</label>
        <select id="desktopToolsWebSearchProvider" class="composer-tools-popover__select" aria-label="Web search provider">
          <option value="searxng">SearXNG</option>
          <option value="duckduckgo">DuckDuckGo</option>
          <option value="brave">Brave API</option>
          <option value="tavily">Tavily API</option>
        </select>
      </div>
      <label class="composer-tools-popover__toggle">
        <input type="checkbox" id="desktopToolsCacheEnabled" aria-describedby="desktopToolsCacheHint">
        <span class="composer-tools-popover__setting-label">Cache read-only results</span>
      </label>
      <p id="desktopToolsCacheHint" class="composer-tools-popover__hint">Per session until the workspace changes.</p>
      <button type="button" class="composer-tools-popover__settings-link" id="desktopToolsOpenSettings">
        <span>All tool settings</span>
        <i class="fi fi-rr-angle-right icon-svg" aria-hidden="true"></i>
      </button>
    </footer>
  `;

  anchor.append(button, popover);
  return anchor;
}

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

  const toolApprovalHost = document.createElement('div');
  toolApprovalHost.id = 'desktopToolApprovalHost';
  toolApprovalHost.className = 'tool-approval-host';
  toolApprovalHost.setAttribute('aria-live', 'polite');
  toolApprovalHost.hidden = true;

  const questionHost = document.createElement('div');
  questionHost.id = 'desktopQuestionHost';
  questionHost.className = 'question-host';
  questionHost.setAttribute('aria-live', 'polite');
  questionHost.hidden = true;

  const modelTriggerRow = document.createElement('div');
  modelTriggerRow.className = 'composer-model-trigger-row';
  const modelTriggerAnchor = document.createElement('div');
  modelTriggerAnchor.id = 'desktopComposerModelAnchor';
  modelTriggerAnchor.className = 'composer-model-trigger-anchor';
  modelTriggerRow.appendChild(modelTriggerAnchor);

  const row = document.createElement('div');
  row.className = 'mn-os-desktop-input-row';

  const brainNotesWrap = document.createElement('div');
  brainNotesWrap.id = 'desktopBrainNotesWrap';
  brainNotesWrap.className = 'desktop-brain-notes-wrap hidden';

  const brainNotesControl = document.createElement('div');
  brainNotesControl.id = 'desktopBrainNotesControl';
  brainNotesControl.className = 'brain-notes-toggle-host';
  brainNotesWrap.appendChild(brainNotesControl);

  const attachBtn = document.createElement('button');
  attachBtn.type = 'button';
  attachBtn.id = 'btnDesktopAttach';
  attachBtn.className = 'mn-os-desktop-comp-btn';
  attachBtn.setAttribute('aria-label', 'Attach files');
  attachBtn.title = 'Attach files';
  attachBtn.innerHTML = iconHtml('attach');

  const inputStack = document.createElement('div');
  inputStack.className = 'mn-os-desktop-input-stack';

  const inputWrap = document.createElement('div');
  inputWrap.className = 'mn-os-desktop-input-wrap';

  const field = document.createElement('textarea');
  field.id = 'desktopInput';
  field.className = 'mn-os-desktop-field';
  field.rows = 1;
  field.placeholder = 'What would you like to do today?';
  field.spellcheck = false;
  inputWrap.appendChild(field);

  inputStack.append(attachPreview, inputWrap);

  const toolsAnchor = buildDesktopToolsAnchor();

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
  sendBtn.innerHTML = MINNOW_GLYPH_HEADER_HTML;

  row.append(brainNotesWrap, attachBtn, inputStack, toolsAnchor, contextAnchor, sendBtn);
  root.append(toolApprovalHost, questionHost, modelTriggerRow, row);
  return root;
}

/** Render the desktop launcher composer. */
export function renderConcierge(container: HTMLElement): void {
  container.replaceChildren();
  container.className = 'mn-os-concierge-mount';

  const conciergeWrap = document.createElement('div');
  conciergeWrap.className = 'mn-os-concierge';

  const composer = buildDesktopComposer();
  conciergeWrap.appendChild(composer);

  const field = composer.querySelector('#desktopInput') as HTMLTextAreaElement;
  const sendBtn = composer.querySelector('#desktopSendBtn') as HTMLButtonElement;

  wireDesktopComposerControls(field);

  function syncUi(): void {
    if (isDesktopChatActive()) {
      syncComposerFromStreamingState();
      sendBtn.disabled = !shouldAllowComposerPrimaryAction(field.value);
      return;
    }
    sendBtn.disabled = !field.value.trim();
  }

  const resizeField = (): void => {
    autoResizeDesktopComposer(field);
  };

  async function submit(text?: string): Promise<void> {
    const q = (text ?? field.value).trim();

    if (isDesktopChatActive()) {
      if (!shouldAllowComposerPrimaryAction(q)) return;
      if (q) {
        field.value = q;
        field.dispatchEvent(new window.Event('input', { bubbles: true }));
      }
      await handleDesktopSend();
      if (!isActiveChatStreaming()) {
        field.value = '';
        autoResizeDesktopComposer(field);
      }
      syncUi();
      return;
    }

    if (!q) return;

    if (isDesktopResearchActive()) {
      const { launchApp } = await import('./router');
      launchApp('research', { seed: q, autoRun: true });
      field.value = '';
      autoResizeDesktopComposer(field);
      syncUi();
      return;
    }

    field.value = '';
    autoResizeDesktopComposer(field);
    await activateDesktopChat({ seed: q });
    syncUi();
  }

  field.addEventListener('input', () => syncUi());
  field.addEventListener('keydown', (e) => {
    if (handleSkillPickerKeydown(e)) return;
    if (handleComposerPromptHistoryKeydown(e, field)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isSkillPickerOpen()) return;
      e.preventDefault();
      void submit();
    }
  });
  sendBtn.addEventListener('click', () => void submit());

  container.appendChild(conciergeWrap);
  resizeField();
  syncUi();
}
