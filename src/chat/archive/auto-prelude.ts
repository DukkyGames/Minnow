import { estimateTokensFromText } from '../prompts/token-estimate-core';
import type { ArchiveRecallHit } from './types';

const PRELUDE_OPEN = '<retrieved_context source="archive">\n';
const PRELUDE_CLOSE = '\n</retrieved_context>';

/** Dedupe hits by path while preserving order. */
export function dedupeArchiveHits(hits: ArchiveRecallHit[]): ArchiveRecallHit[] {
  const seen = new Set<string>();
  const out: ArchiveRecallHit[] = [];
  for (const hit of hits) {
    const key = hit.path;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

/** Build the auto-prelude system message content (empty string when no hits). */
export function buildArchivePreludeBlock(
  hits: ArchiveRecallHit[],
  topK: number,
): { content: string; recalled: number; recallTokens: number } {
  const capped = dedupeArchiveHits(hits).slice(0, Math.max(1, topK));
  if (capped.length === 0) {
    return { content: '', recalled: 0, recallTokens: 0 };
  }

  const sections: string[] = [];
  for (const hit of capped) {
    const lines: string[] = [`### ${hit.title} (\`${hit.path}\`)`];
    if (hit.sourceQuote?.trim()) {
      lines.push(`> ${hit.sourceQuote.trim()}`);
    }
    if (hit.excerpt?.trim()) {
      lines.push(hit.excerpt.trim());
    }
    if (hit.backlinks?.length) {
      lines.push(`Backlinks: ${hit.backlinks.map((p) => `\`${p}\``).join(', ')}`);
    }
    sections.push(lines.join('\n'));
  }

  const body = sections.join('\n\n');
  const content = PRELUDE_OPEN + body + PRELUDE_CLOSE;
  return {
    content,
    recalled: capped.length,
    recallTokens: estimateTokensFromText(content),
  };
}
