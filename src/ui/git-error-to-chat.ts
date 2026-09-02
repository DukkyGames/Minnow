export type GitErrorChatKind = 'commit' | 'merge';

export interface GitErrorChatContext {
  /** Effective git worktree root (undefined = main workspace). */
  cwd?: string;
  /** Current branch name when known. */
  branch?: string;
}

/** Build the seeded user message for an agent to fix a git commit or merge failure. */
export function buildGitErrorFixSeedMessage(
  kind: GitErrorChatKind,
  error: string,
  ctx?: GitErrorChatContext,
): string {
  const trimmedError = error.trim() || 'Unknown git error';
  const lines: string[] = [];

  if (kind === 'commit') {
    lines.push(
      'A git commit failed in Source Control. Diagnose and fix the issue so the commit can succeed.',
    );
  } else {
    lines.push(
      'A git merge failed in Source Control. Diagnose and fix the merge issue (conflicts or other blockers).',
    );
  }

  lines.push('', 'Error:', '```', trimmedError, '```');

  const cwd = ctx?.cwd?.trim();
  if (cwd) {
    lines.push('', `Worktree: \`${cwd}\``);
  }

  const branch = ctx?.branch?.trim();
  if (branch) {
    lines.push('', `Branch: \`${branch}\``);
  }

  lines.push(
    '',
    'Use git tools to investigate (`git_status`, diffs, etc.).',
    kind === 'merge'
      ? 'If merge conflicts are present, resolve markers, stage resolved paths, and finish the merge commit. Do not run `git merge --abort` unless I ask.'
      : 'When the blocker is resolved, stage any needed paths and complete the commit with an appropriate message.',
  );

  return lines.join('\n');
}

/** Ensure the Code chat composer is visible before starting a fixer chat. */
async function ensureCodeChatSurface(): Promise<void> {
  const { isCodeOverviewOpen } = await import('./code-overview');
  if (!isCodeOverviewOpen()) return;
  const { closeCodeOverview } = await import('./code-overview');
  const { navigateToCodeChat } = await import('../os/router');
  closeCodeOverview({ skipNavigate: true, restoreChat: false });
  navigateToCodeChat();
}

/** Start a new Build chat seeded with instructions to fix a commit/merge error. */
export async function sendGitErrorToChat(
  kind: GitErrorChatKind,
  error: string,
  ctx?: GitErrorChatContext,
): Promise<void> {
  await ensureCodeChatSurface();
  const { createChatWithMode } = await import('./sidebar');
  const seed = buildGitErrorFixSeedMessage(kind, error, ctx);
  createChatWithMode({
    modeId: 'build',
    initialUserMessage: seed,
  });
}

/** Update a git panel status row: message text plus optional Send to chat action. */
export function renderGitStatusWithSendToChat(
  host: HTMLElement,
  messageEl: HTMLElement,
  message: string,
  isError: boolean,
  sendToChat?: GitErrorChatKind,
  ctx?: GitErrorChatContext,
): void {
  messageEl.textContent = message;
  messageEl.classList.toggle('is-err', isError);
  host.hidden = !message;

  host.querySelector('.git-panel-status-chat-btn')?.remove();

  if (!isError || !message.trim() || !sendToChat) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'git-panel-status-chat-btn';
  btn.textContent = 'Send to chat';
  btn.title = 'Start a new chat and ask the agent to fix this';
  btn.setAttribute('aria-label', 'Send git error to chat');
  btn.addEventListener('click', () => {
    void sendGitErrorToChat(sendToChat, message, ctx);
  });
  host.appendChild(btn);
}

/** Append Send to chat to a Git Center conflict / error action row. */
export function appendGitErrorSendToChatButton(
  actions: HTMLElement,
  kind: GitErrorChatKind,
  error: string,
  ctx?: GitErrorChatContext,
): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'git-panel-action-btn git-panel-status-chat-btn';
  btn.textContent = 'Send to chat';
  btn.title = 'Start a new chat and ask the agent to fix this';
  btn.setAttribute('aria-label', 'Send git error to chat');
  btn.addEventListener('click', () => {
    void sendGitErrorToChat(kind, error, ctx);
  });
  actions.appendChild(btn);
}
