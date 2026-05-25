/**
 * Format capability badges for the model picker (pure helpers for tests).
 */

import type { ModelCapabilities } from '../types';

const MAX_BADGES = 3;

/** Human-readable context length (e.g. 32768 → "32k"). */
export function formatContextBadge(contextLength: number | null | undefined): string | null {
  if (contextLength === null || contextLength === undefined) return null;
  if (!Number.isFinite(contextLength) || contextLength <= 0) return null;
  if (contextLength >= 1_000_000) {
    const m = contextLength / 1_000_000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (contextLength >= 1000) {
    const k = contextLength / 1000;
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return String(Math.round(contextLength));
}

/** Up to three short badges for a model row. */
export function formatCapabilityBadges(caps: ModelCapabilities | undefined): string[] {
  if (!caps) return [];
  const badges: string[] = [];
  if (caps.tools === true) badges.push('Tools');
  if (caps.vision === true) badges.push('Vision');
  const ctx = formatContextBadge(caps.contextLength);
  if (ctx) badges.push(ctx);
  if (badges.length < MAX_BADGES && caps.tools === false) badges.push('No tools');
  return badges.slice(0, MAX_BADGES);
}

/** Multi-line tooltip summarizing capabilities. */
export function formatCapabilityTooltip(
  modelId: string,
  caps: ModelCapabilities | undefined,
  probedAt?: string,
): string {
  const lines = [modelId];
  if (!caps) return lines.join('\n');

  const yn = (v: boolean | null | undefined) => {
    if (v === true) return 'yes';
    if (v === false) return 'no';
    return '?';
  };

  lines.push(`Vision: ${yn(caps.vision)}`);
  lines.push(`Tools: ${yn(caps.tools)}`);
  lines.push(`Streaming: ${yn(caps.streaming)}`);
  const ctx = formatContextBadge(caps.contextLength);
  lines.push(`Context: ${ctx ?? '?'}`);
  if (caps.grammar !== null && caps.grammar !== undefined) {
    lines.push(`Grammar: ${yn(caps.grammar)}`);
  }
  if (probedAt && probedAt !== new Date(0).toISOString()) {
    lines.push(`Last probed: ${probedAt}`);
  }
  return lines.join('\n');
}
