/**
 * Chat-scoped Brain archive recall tool (MIN-139).
 */

import { brainWorkspaceKeyFromPath } from '../lib/brain-workspace-key';
import { retrieveChatArchive } from '../chat/archive/store-client';
import { getActiveChat } from '../state/sessions';
import { getWorkspacePath } from '../state/workspace';

/** Browser tool handler: recall_chat_context */
export async function toolRecallChatContext(
  args: Record<string, unknown>,
): Promise<string> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return 'Error: "query" is required';
  }

  const topKRaw = args.topK;
  const topK =
    typeof topKRaw === 'number' && Number.isFinite(topKRaw)
      ? Math.min(20, Math.max(1, Math.floor(topKRaw)))
      : 5;

  const chat = getActiveChat();
  const workspaceKey =
    brainWorkspaceKeyFromPath(chat.workspacePath || getWorkspacePath()) || 'workspace';

  const result = await retrieveChatArchive(query, workspaceKey, chat.id, topK);
  if (!result) {
    return 'Error: Brain archive retrieve failed (is npm start running?)';
  }

  const hits = result.hits ?? [];
  if (hits.length === 0) {
    return `No archived context found for: ${query}`;
  }

  const blocks = hits.map((hit, i) => {
    const lines = [`${i + 1}. ${hit.title} (\`${hit.path}\`)`];
    if (hit.sourceQuote?.trim()) {
      lines.push(`   Quote: "${hit.sourceQuote.trim()}"`);
    }
    if (hit.excerpt?.trim()) {
      lines.push(`   ${hit.excerpt.trim().slice(0, 400)}`);
    }
    if (hit.backlinks?.length) {
      lines.push(`   Backlinks: ${hit.backlinks.join(', ')}`);
    }
    return lines.join('\n');
  });

  return `Archived context for "${query}":\n\n${blocks.join('\n\n')}`;
}
