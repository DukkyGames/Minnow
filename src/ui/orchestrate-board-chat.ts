/**
 * Board chats open inside the Orchestrate main pane.
 *
 * Board chats are not listed in the chats panel (see `isBoardOwnedChat`), so
 * clicking one on the board must not tear the board down and hand the column to
 * a transcript with no home. Instead `.board-root` is parked and a `.ob-chat`
 * host takes its place inside `.ob-main`, with the rail switching from the board
 * library to this board's chats.
 *
 * Parking rather than destroying matters: a 31-task board is expensive to
 * rebuild, and the run keeps streaming while you read one task's transcript.
 */

import { isChatStreaming } from '../chat/streaming-state';
import {
  getBoardGroupForChat,
  listBoardGroupChatIds,
} from '../state/chat-groups';
import { sessionState } from '../state/sessions';
import type { BoardTask, Chat, ChatGroup } from '../types';
import { appConfirm } from './app-dialog';
import {
  ORCHESTRATE_CHAT_PANE_TESTID,
  getOpenBoardChatId,
  isBoardChatEmbedOpen,
  queryBoardChatTranscriptHost,
  setOpenBoardChatId,
} from './orchestrate-board-chat-state';

export { queryBoardChatTranscriptHost };

const OB_CHAT_CLASS = 'ob-chat';
const PAGE_CHAT_OPEN_CLASS = 'is-chat-open';
/**
 * Marks the column while a board chat is open, so the composer and its strips
 * come back. A class on `.main-column` (the idiom every other stage view uses)
 * rather than `:has(.ob-chat)`: `:has()` did not reliably re-invalidate when the
 * host is added deep in the subtree, leaving the composer hidden.
 */
const MAIN_COLUMN_CHAT_CLASS = 'main-column--board-chat';

function syncMainColumnBoardChatClass(open: boolean): void {
  document
    .getElementById('mainColumn')
    ?.classList.toggle(MAIN_COLUMN_CHAT_CLASS, open);
}

/** Board root parked while a chat is showing, so returning does not rebuild it. */
let parkedBoardRoot: HTMLElement | null = null;

/** Rail-local wave collapse, keyed by wave. Board collapse state stays untouched. */
const collapsedWaves = new Set<string>();

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** The `.ob-page` for the mounted board, if Orchestrate currently owns the column. */
function queryOrchestratePage(): HTMLElement | null {
  const page = document.getElementById('orchestrateBoardPage');
  return page instanceof HTMLElement ? page : null;
}

function queryObMain(): HTMLElement | null {
  const main = queryOrchestratePage()?.querySelector(':scope > .ob-shell > .ob-main');
  return main instanceof HTMLElement ? main : null;
}

/** Escape-to-board, released on unmount. */
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;

/** True when a keystroke belongs to text entry and must not be hijacked. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function bindEscapeToBoard(onBack: () => void): void {
  unbindEscapeToBoard();
  escapeHandler = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    // Composer text, rename fields and the row context menu own Escape first.
    if (isTypingTarget(e.target)) return;
    if (document.getElementById('chatItemContextMenu')) return;
    e.preventDefault();
    onBack();
  };
  document.addEventListener('keydown', escapeHandler);
}

function unbindEscapeToBoard(): void {
  if (!escapeHandler) return;
  document.removeEventListener('keydown', escapeHandler);
  escapeHandler = null;
}

/** Rail-local wave collapse toggle (rail repaint is the caller's job). */
export function toggleBoardChatRailWave(key: string): void {
  if (collapsedWaves.has(key)) collapsedWaves.delete(key);
  else collapsedWaves.add(key);
}

export function boardChatRailCollapsedWaves(): ReadonlySet<string> {
  return collapsedWaves;
}

/** Task a chat is linked to, for the header's id and state line. */
function findTaskForChat(group: ChatGroup, chatId: string): BoardTask | undefined {
  const board = group.orchestrateBoard;
  if (!board) return undefined;
  return board.tasks.find(
    (t) =>
      t.chatId?.trim() === chatId ||
      t.testChatId?.trim() === chatId ||
      t.fixerChatId?.trim() === chatId,
  );
}

/** Human label for the header's state chip. */
function headerStateLabel(chat: Chat, task: BoardTask | undefined): string {
  if (isChatStreaming(chat.id)) return 'Running';
  if (chat.turnError) return 'Error';
  if (!task) return 'Idle';
  switch (task.status) {
    case 'planned':
      return 'Not started';
    case 'in_progress':
      return 'In progress';
    case 'testing':
      return 'Testing';
    case 'complete':
      return 'Complete';
    case 'failed':
      return 'Failed';
    case 'quarantined':
      return 'Quarantined';
    default:
      return String(task.status).replace(/_/g, ' ');
  }
}

/** Semantic class for the state chip; colour never carries the meaning alone. */
function headerStateTone(chat: Chat, task: BoardTask | undefined): string {
  if (isChatStreaming(chat.id)) return 'is-running';
  if (chat.turnError || task?.status === 'failed' || task?.status === 'quarantined') {
    return 'is-failed';
  }
  if (task?.status === 'complete') return 'is-complete';
  return '';
}

function buildChatHeader(
  chat: Chat,
  group: ChatGroup,
  onBack: () => void,
): HTMLElement {
  const head = el('header', 'ob-chat__head');

  const back = el('button', 'ob-chat__back') as HTMLButtonElement;
  back.type = 'button';
  back.append(el('span', 'ob-chat__back-caret', '‹'), document.createTextNode('Board'));
  back.setAttribute('aria-label', 'Back to board');
  back.addEventListener('click', onBack);

  const titleWrap = el('div', 'ob-chat__titles');
  const title = el('h2', 'ob-chat__title', chat.name?.trim() || 'Task chat');

  const task = findTaskForChat(group, chat.id);
  const meta = el('p', 'ob-chat__meta');
  const bits: string[] = [];
  if (task) bits.push(task.id);
  if (task?.wave != null) bits.push(`wave ${task.wave}`);
  meta.textContent = bits.join(' · ');
  if (!bits.length) meta.hidden = true;

  const state = el('span', `ob-chat__state ${headerStateTone(chat, task)}`.trim());
  state.textContent = headerStateLabel(chat, task);
  state.setAttribute('role', 'status');

  titleWrap.append(title, meta);
  head.append(back, titleWrap, state);
  return head;
}

/**
 * Build (or reuse) the `.ob-chat` host inside `.ob-main`, parking the board.
 * @returns the transcript element the caller paints into, or null when
 *          Orchestrate does not own the column.
 */
export function mountBoardChatHost(
  chat: Chat,
  group: ChatGroup,
  onBack: () => void,
): HTMLElement | null {
  const main = queryObMain();
  if (!main) return null;

  const boardRoot = main.querySelector(':scope > .board-root');
  if (boardRoot instanceof HTMLElement) {
    parkedBoardRoot = boardRoot;
    boardRoot.remove();
  }

  let host = main.querySelector(`:scope > .${OB_CHAT_CLASS}`);
  if (!(host instanceof HTMLElement)) {
    host = el('section', OB_CHAT_CLASS);
    host.setAttribute('aria-label', 'Board chat');
    main.appendChild(host);
  }
  host.replaceChildren();

  const scroll = el('div', 'ob-chat__scroll');
  const transcript = el('div', 'ob-chat__transcript chat-area');
  transcript.dataset.testid = ORCHESTRATE_CHAT_PANE_TESTID;
  scroll.appendChild(transcript);
  host.append(buildChatHeader(chat, group, onBack), scroll);

  queryOrchestratePage()?.classList.add(PAGE_CHAT_OPEN_CLASS);
  syncMainColumnBoardChatClass(true);
  bindEscapeToBoard(onBack);
  void import('./chat-scroll').then((m) => m.bindOrchestrateBoardChatScroll());
  return transcript;
}

/** Refresh the header in place (stream state changed, chat renamed). */
export function refreshBoardChatHeader(): void {
  const openId = getOpenBoardChatId();
  if (!openId || !sessionState) return;
  const host = document.querySelector(`.${OB_CHAT_CLASS}`);
  if (!(host instanceof HTMLElement)) return;
  const chat = sessionState.chats.find((c) => c.id === openId);
  const group = chat ? getBoardGroupForChat(chat) : undefined;
  if (!chat || !group) return;
  const oldHead = host.querySelector(':scope > .ob-chat__head');
  if (!(oldHead instanceof HTMLElement)) return;
  const back = oldHead.querySelector('.ob-chat__back');
  const onBack = (): void => {
    if (back instanceof HTMLButtonElement) back.click();
  };
  oldHead.replaceWith(buildChatHeader(chat, group, onBack));
}

/**
 * Remove the chat host and put the parked board back.
 * @returns true when a chat host was actually torn down.
 */
export function unmountBoardChatHost(): boolean {
  const main = queryObMain();
  const host = main?.querySelector(`:scope > .${OB_CHAT_CLASS}`);
  queryOrchestratePage()?.classList.remove(PAGE_CHAT_OPEN_CLASS);
  syncMainColumnBoardChatClass(false);
  unbindEscapeToBoard();
  if (!(host instanceof HTMLElement)) {
    parkedBoardRoot = null;
    return false;
  }
  host.remove();
  if (parkedBoardRoot && main && !main.querySelector(':scope > .board-root')) {
    main.appendChild(parkedBoardRoot);
  }
  parkedBoardRoot = null;
  return true;
}

/**
 * Close the embed without repainting anything.
 * Used by navigation teardown, where the caller owns what paints next.
 */
export function closeBoardChatEmbedForTeardown(): void {
  if (!isBoardChatEmbedOpen()) return;
  setOpenBoardChatId(null);
  unmountBoardChatHost();
}

/** Confirm text for deleting a chat the board still points at. */
export async function confirmBoardChatDelete(chat: Chat): Promise<boolean> {
  const group = getBoardGroupForChat(chat);
  const referenced =
    group != null &&
    listBoardGroupChatIds(group, sessionState?.chats ?? []).includes(chat.id);
  const label = chat.name?.trim() || 'this chat';
  const message = referenced
    ? `Delete "${label}"? The board keeps its task, but the task loses this transcript and it cannot be recovered.`
    : `Delete "${label}"? Messages in this chat cannot be recovered.`;
  return appConfirm(message, { confirmLabel: 'Delete', danger: true });
}
