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
import { handleDesktopResearchSubmit } from './research-desktop';
import { MINNOW_GLYPH_HEADER_HTML } from '../ui/minnow-glyph';

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

  const attachBtn = document.createElement('button');
  attachBtn.type = 'button';
  attachBtn.id = 'btnDesktopAttach';
  attachBtn.className = 'mn-os-desktop-comp-btn';
  attachBtn.setAttribute('aria-label', 'Attach files');
  attachBtn.title = 'Attach files';
  attachBtn.innerHTML =
    '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';

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

  row.append(attachBtn, inputStack, contextAnchor, sendBtn);
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
      field.value = q;
      field.dispatchEvent(new window.Event('input', { bubbles: true }));
      await handleDesktopResearchSubmit();
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
