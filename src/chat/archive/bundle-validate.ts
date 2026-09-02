import type { ApiMessage } from '../../types';
import { apiMessageContentToText } from '../../api/message-content';
import type { ArchiveBundlePayload, ArchiveFact } from './types';

function turnTextAtIndex(turns: ApiMessage[], historyIndex: number): string {
  const msg = turns[historyIndex];
  if (!msg) return '';
  if (msg.role === 'system') return '';
  return apiMessageContentToText(
    msg.role === 'user' || msg.role === 'assistant' ? msg.content : msg.content,
  );
}

/** Map sourceTurnIndices positions to bundled turn array indices. */
function buildTurnTextByHistoryIndex(
  turns: ApiMessage[],
  sourceTurnIndices: number[],
): Map<number, string> {
  const map = new Map<number, string>();
  for (let i = 0; i < sourceTurnIndices.length; i += 1) {
    const histIdx = sourceTurnIndices[i];
    map.set(histIdx, apiMessageContentToText(turns[i]?.content ?? ''));
  }
  return map;
}

export interface BundleValidationResult {
  ok: boolean;
  facts: ArchiveFact[];
  errors: string[];
}

export function validateArchiveBundle(
  bundle: ArchiveBundlePayload,
  turns: ApiMessage[],
  sourceTurnIndices: number[],
): BundleValidationResult {
  const errors: string[] = [];
  const textByIndex = buildTurnTextByHistoryIndex(turns, sourceTurnIndices);
  const validFacts: ArchiveFact[] = [];

  for (const fact of bundle.facts ?? []) {
    const quote = String(fact.sourceQuote ?? '').trim();
    const statement = String(fact.statement ?? '').trim();
    const turnIdx = fact.sourceTurnIndex;
    if (!quote || !statement) {
      errors.push('Fact missing statement or sourceQuote');
      continue;
    }
    const sourceText = textByIndex.get(turnIdx) ?? turnTextAtIndex(turns, turnIdx);
    if (!sourceText.includes(quote)) {
      errors.push(`sourceQuote not found in turn ${turnIdx}`);
      continue;
    }
    validFacts.push({
      statement,
      sourceQuote: quote,
      sourceTurnIndex: turnIdx,
    });
  }

  for (const entity of bundle.entities ?? []) {
    const slug = String(entity.slug ?? '').trim();
    if (!slug || /[^a-z0-9._-]/i.test(slug)) {
      errors.push(`Invalid entity slug: ${entity.slug}`);
    }
  }

  if (validFacts.length === 0) {
    errors.push('Bundle has zero anchored facts');
  }

  return { ok: errors.length === 0 && validFacts.length > 0, facts: validFacts, errors };
}
