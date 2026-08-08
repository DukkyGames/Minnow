/**
 * Code-change strip control: undo the last agent turn (chat rewind + file restore).
 * Lives next to #codeChangeStrip; Uicons undo glyph via createIcon.
 * Hidden when the workspace is not a git repository (no snapshots) or the undo
 * target turn did not mutate files (chat-only rewind stays on message ⋮).
 */

import {
  canUndoTurn,
  getUndoEligibility,
  undoLastAgentTurn,
  UNDO_STATUS,
  undoBlockMessage,
} from '../chat/undo-turn';
import { createIcon } from './icon';
import { isWorkspaceGitRepo } from '../state/git-workspace';
import { findRunById } from '../state/runs-store';
import { getActiveChat } from '../state/sessions';
import { getWorkspacePath } from '../state/workspace';
import { runHadCodeChanges } from '../usage/code-change-ledger';
import { renderChatFromHistory, renderStatsForChat } from './messages';
import { renderSidebar } from './sidebar';
import { setStatus } from './status';
import { syncCodeChangeStripWrapVisibility } from './code-change-strip';

const TITLE_ENABLED = 'Undo last agent turn';
/** Prefer the strip-area id; keep legacy id as a fallback for older DOM. */
const UNDO_BUTTON_IDS = ['btnCodeChangeUndo', 'btnComposerUndo'] as const;
/** Avoid hammering /api/workspace/git-status on every sidebar re-render. */
const GIT_CACHE_MS = 8_000;

let btnEl: HTMLButtonElement | null = null;
let gitCache: { path: string; isRepo: boolean; at: number } | null = null;
/** Monotonic token so overlapping async syncs don't apply stale visibility. */
let syncGen = 0;

function findExistingButton(): HTMLButtonElement | null {
  for (const id of UNDO_BUTTON_IDS) {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (el) return el;
  }
  return null;
}

/** Static markup may ship a placeholder span; inject the Uicons glyph if missing. */
function ensureUndoIcon(btn: HTMLButtonElement): void {
  if (btn.querySelector('.code-change-strip__undo-icon.fi')) return;
  const placeholder = btn.querySelector('.code-change-strip__undo-icon');
  const icon = createIcon('undo', { className: 'code-change-strip__undo-icon', size: 14 });
  if (placeholder) placeholder.replaceWith(icon);
  else btn.appendChild(icon);
}

/** Ensure the undo control exists beside the code-change strip (idempotent). */
function ensureButton(): HTMLButtonElement | null {
  if (btnEl?.isConnected) return btnEl;
  const existing = findExistingButton();
  if (existing) {
    ensureUndoIcon(existing);
    btnEl = existing;
    return btnEl;
  }

  // Fallback: inject into the strip row if markup was not present.
  const row =
    document.querySelector('.code-change-strip-row') ??
    document.querySelector('.code-change-strip-wrap');
  if (!row) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'btnCodeChangeUndo';
  btn.className = 'code-change-strip__undo';
  btn.setAttribute('aria-label', TITLE_ENABLED);
  btn.title = TITLE_ENABLED;
  btn.disabled = true;
  btn.hidden = true;
  btn.setAttribute('aria-disabled', 'true');

  const icon = createIcon('undo', { className: 'code-change-strip__undo-icon', size: 14 });
  btn.appendChild(icon);

  row.appendChild(btn);
  btnEl = btn;
  return btn;
}

/** Tooltip / aria when disabled — prefer eligibility message, then reason fallback. */
function disabledHint(eligibility: ReturnType<typeof getUndoEligibility>): string {
  if (eligibility.message?.trim()) return eligibility.message;
  if (eligibility.reason) return undoBlockMessage(eligibility.reason);
  return 'Undo unavailable';
}

/** Cached workspace git check; path change or TTL expiry refetches. */
async function workspaceHasGitRepo(): Promise<boolean> {
  const path = getWorkspacePath().trim();
  const now = Date.now();
  if (
    gitCache &&
    gitCache.path === path &&
    now - gitCache.at < GIT_CACHE_MS
  ) {
    return gitCache.isRepo;
  }
  const isRepo = await isWorkspaceGitRepo(path || undefined);
  gitCache = { path, isRepo, at: now };
  return isRepo;
}

/** Drop cache after workspace switch / git init so the next sync rechecks. */
export function invalidateComposerUndoGitCache(): void {
  gitCache = null;
}

async function onUndoClick(): Promise<void> {
  const chat = getActiveChat();
  // Strip undo requires git — refuse if the workspace lost its repo mid-session.
  if (!(await workspaceHasGitRepo())) {
    setStatus('err', 'Undo needs a git repository in this workspace');
    syncComposerUndoFromActiveChat();
    return;
  }

  const eligibility = getUndoEligibility(chat);
  if (!eligibility.ok) {
    setStatus('err', eligibility.message ?? 'Undo unavailable');
    return;
  }

  const result = await undoLastAgentTurn(chat.id);
  if (!result.ok) {
    if (result.error === 'cancelled') {
      setStatus('ok', UNDO_STATUS.cancelled);
      syncComposerUndoFromActiveChat();
      return;
    }
    const msg =
      result.error === 'streaming'
        ? undoBlockMessage('streaming')
        : UNDO_STATUS.failed;
    setStatus(result.error === 'streaming' ? 'spin' : 'err', msg);
    syncComposerUndoFromActiveChat();
    return;
  }

  const updated = getActiveChat();
  renderChatFromHistory(updated);
  renderStatsForChat(updated);
  renderSidebar();
  syncComposerUndoFromActiveChat();

  const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  input?.focus();

  setStatus(
    'ok',
    result.filesRestored ? UNDO_STATUS.successFiles : UNDO_STATUS.successChat,
  );
}

/** Wire the code-change strip Undo control (idempotent). */
export function initComposerUndo(): void {
  const btn = ensureButton();
  if (!btn || btn.dataset.undoBound === '1') {
    syncComposerUndoFromActiveChat();
    return;
  }
  btn.dataset.undoBound = '1';
  btn.addEventListener('click', () => {
    void onUndoClick();
  });
  syncComposerUndoFromActiveChat();
}

/**
 * Refresh visibility / disabled state from the active chat.
 * Hidden when the workspace is not a git repository or the undo target had no file edits.
 */
export function syncComposerUndoFromActiveChat(): void {
  const btn = ensureButton();
  if (!btn) return;

  const gen = ++syncGen;
  void (async () => {
    const hasGit = await workspaceHasGitRepo();
    if (gen !== syncGen) return;

    const chat = getActiveChat();
    const eligibility = getUndoEligibility(chat);
    const target = eligibility.target;
    const run = target ? findRunById(chat, target.runId) : undefined;
    const targetChangedFiles =
      target && run ? runHadCodeChanges(chat, run) : false;

    // No git or no file edits on the undo target → hide (chat-only undo stays on ⋮).
    if (!hasGit || !targetChangedFiles) {
      btn.hidden = true;
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.dataset.undoReason = !hasGit ? 'no_git' : 'no_file_changes';
      syncCodeChangeStripWrapVisibility();
      return;
    }

    btn.hidden = false;

    const enabled = eligibility.ok && canUndoTurn(chat);
    btn.disabled = !enabled;

    const hint = enabled ? TITLE_ENABLED : disabledHint(eligibility);

    btn.title = hint;
    btn.setAttribute('aria-label', hint);
    btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    btn.dataset.undoReason = eligibility.reason ?? '';
    syncCodeChangeStripWrapVisibility();
  })();
}

/** Re-sync when streaming / chat switches (loop + sidebar). */
export function refreshComposerUndoDisabled(): void {
  syncComposerUndoFromActiveChat();
}
