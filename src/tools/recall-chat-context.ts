import { brainWorkspaceKeyFromPath } from '../lib/brain-workspace-key';
import { retrieveArchive } from '../chat/archive/store-client';
import type { ArchiveRecallHit, ArchiveRetrieveScope } from '../chat/archive/types';
import { getActiveChat } from '../state/sessions';
import { getWorkspacePath } from '../state/workspace';

/** Resolve retrieve scope from tool args (workspace recall is opt-in). */
export function resolveRecallScope(
  args: Record<string, unknown>,
  chatId: string,
): ArchiveRetrieveScope {
  return args.scope === 'workspace' ? { mode: 'workspace' } : { chatId };
}

/** Format retrieve hits for the model (pure, testable). */
export function formatArchiveRecallOutput(
  query: string,
  hits: ArchiveRecallHit[],
  scopeNote: string,
): string {
  if (hits.length === 0) {
    return `No archived context found for ${scopeNote}: ${query}`;
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
  return `Archived context for "${query}"${scopeNote}:\n\n${blocks.join('\n\n')}`;
}

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
  const scope = resolveRecallScope(args, chat.id);
  const workspaceKey =
    brainWorkspaceKeyFromPath(chat.workspacePath || getWorkspacePath()) || 'workspace';

  const result = await retrieveArchive(query, workspaceKey, scope, topK);
  if (!result) {
    return 'Error: Brain archive retrieve failed (is Minnow running locally?)';
  }

  const scopeNote =
    args.scope === 'workspace' ? ' (workspace scope)' : ' (chat scope)';
  const scopeLabel = args.scope === 'workspace' ? 'workspace' : 'this chat';
  const hits = result.hits ?? [];
  if (hits.length === 0) {
    return formatArchiveRecallOutput(query, hits, scopeLabel);
  }
  return formatArchiveRecallOutput(query, hits, scopeNote.trim());
}
