/**
 * Resolve the prompt for a maintenance /loop (empty promptText).
 * Prefers `<workspace>/.minnow/loop.md`, else a built-in checklist prompt.
 */

import type { Chat } from '../../types';
import { executeTool } from '../../tools/client';

/** Built-in maintenance prompt when `.minnow/loop.md` is missing or empty. */
export const BUILTIN_MAINTENANCE_LOOP_PROMPT = [
  'Run a brief workspace maintenance check and report only what matters:',
  '1. Git status — dirty files, untracked paths, and whether HEAD is behind/ahead of upstream.',
  '2. Failing or flaky tests — run the most relevant scoped suite if cheap; otherwise note what to run.',
  '3. Stale TODOs/FIXMEs in recently touched areas (do not dump the whole repo).',
  'Keep the reply short and actionable. If nothing needs attention, say so in one sentence.',
].join('\n');

const LOOP_MD_RELATIVE_PATH = '.minnow/loop.md';

/**
 * Read workspace `.minnow/loop.md` via the tools API using this chat's workspace.
 * Returns trimmed content, or empty string when missing/unreadable.
 */
export async function readWorkspaceLoopMarkdown(chat: Chat): Promise<string> {
  const workspaceRoot = chat.workspacePath?.trim();
  try {
    const result = await executeTool(
      'read_file',
      { path: LOOP_MD_RELATIVE_PATH },
      {
        chatId: chat.id,
        ...(workspaceRoot ? { workspaceRoot } : {}),
      },
    );
    const content = typeof result.content === 'string' ? result.content.trim() : '';
    // Tool errors are returned as content starting with "Error:"
    if (!content || /^error:/i.test(content)) return '';
    return content;
  } catch {
    return '';
  }
}

/**
 * Resolve the text to send for a loop fire.
 * Empty promptText → maintenance file or built-in constant (re-read each fire).
 */
export async function resolveLoopPromptText(
  chat: Chat,
  promptText: string,
): Promise<string> {
  const trimmed = promptText.trim();
  if (trimmed) return trimmed;

  const fromFile = await readWorkspaceLoopMarkdown(chat);
  return fromFile || BUILTIN_MAINTENANCE_LOOP_PROMPT;
}
