/**
 * Parse gpt-oss Harmony-format tool calls embedded in assistant `content`
 * when the provider streams commentary-channel output instead of `tool_calls`.
 */

import type { ToolCall } from '../types';

/** Namespace prefixes local stacks add before the Minnow tool id. */
const HARMONY_TOOL_NAME_PREFIXES = [
  'functions.',
  'repo_browser.',
  'browser.',
  'tools.',
] as const;

/** Generate stable synthetic ids for harmony rows parsed from message content. */
function syntheticHarmonyToolCallId(index: number): string {
  return `call_harmony_${index}`;
}

/** Strip Harmony namespaces so `functions.read_file` becomes `read_file`. */
export function normalizeHarmonyToolName(raw: string): string {
  let name = raw.trim();
  if (!name) {
    return '';
  }
  for (const prefix of HARMONY_TOOL_NAME_PREFIXES) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }
  return name;
}

/** Extract a balanced `{…}` JSON object starting at `startIndex`. */
export function extractBalancedJsonObject(text: string, startIndex: number): string | null {
  const braceStart = text.indexOf('{', startIndex);
  if (braceStart < 0) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = braceStart; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(braceStart, i + 1);
      }
    }
  }
  return null;
}

interface HarmonyToolCallMatch {
  name: string;
  argsJson: string;
}

/** Locate `to={recipient}` plus a JSON payload in a Harmony commentary segment. */
function findHarmonyToolCallMatch(segment: string): HarmonyToolCallMatch | null {
  const toMatch = /\bto=([^\s<|]+)/i.exec(segment);
  if (!toMatch) {
    return null;
  }
  const name = normalizeHarmonyToolName(toMatch[1] ?? '');
  if (!name) {
    return null;
  }

  const payloadStart = segment.search(/<\|message\|>|(?:\bcode\s*)(?={)/i);
  const jsonStart = payloadStart >= 0 ? payloadStart : toMatch.index ?? 0;
  const argsJson = extractBalancedJsonObject(segment, jsonStart);
  if (!argsJson) {
    return null;
  }

  return { name, argsJson };
}

/**
 * Parse Harmony commentary tool calls from assistant text.
 * Supports canonical `<|message|>{json}` and LM Studio `code{json}` variants.
 */
export function tryParseHarmonyToolCallsFromText(text: string): ToolCall[] {
  if (!text || !/\bto=/i.test(text)) {
    return [];
  }

  const segments: string[] = [];
  const commentaryRe = /<\|channel\|>commentary/gi;
  let match: RegExpExecArray | null = commentaryRe.exec(text);
  if (match) {
    while (match) {
      const start = match.index;
      const next = commentaryRe.exec(text);
      const end = next ? next.index : text.length;
      segments.push(text.slice(start, end));
      match = next;
    }
  } else if (/<\|channel\|>/i.test(text)) {
    // Commentary marker missing from regex routing — still try the whole blob.
    segments.push(text);
  } else {
    segments.push(text);
  }

  const out: ToolCall[] = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    const parsed = findHarmonyToolCallMatch(segment);
    if (!parsed) {
      continue;
    }
    const dedupeKey = `${parsed.name}\0${parsed.argsJson}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    let argStr = parsed.argsJson;
    try {
      argStr = JSON.stringify(JSON.parse(parsed.argsJson) as unknown);
    } catch {
      // Keep raw slice when the model emitted slightly invalid JSON.
    }

    const index = out.length;
    out.push({
      id: syntheticHarmonyToolCallId(index),
      type: 'function',
      function: { name: parsed.name, arguments: argStr },
    });
  }

  return out;
}
