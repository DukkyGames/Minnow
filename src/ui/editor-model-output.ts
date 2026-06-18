/**
 * Strip inline thinking and interleaved originals from editor AI model output.
 */

import { extractInlineThinkingFromContent } from '../api/inline-thinking';

const RT = 'redacted_thinking';
const THINK_STRIP_PATTERNS = [
  new RegExp(`<${RT}>[\\s\\S]*?<\\/${RT}>\\s*`, 'gi'),
  /<think(?:ing)?(?:\s+[^>]*)?>[\s\S]*?<\/think(?:ing)?>\s*/gi,
  new RegExp(`<${RT}>[\\s\\S]*$`, 'i'),
  /<think(?:ing)?(?:\s+[^>]*)?>[\s\S]*$/i,
];

/** Remove tagged thinking blocks; returns empty while a block is still open. */
function stripInlineThinkingTags(text: string): string {
  let value = text;
  let prev = '';
  while (prev !== value) {
    prev = value;
    for (const re of THINK_STRIP_PATTERNS) {
      value = value.replace(re, '');
    }
  }
  return value;
}

/**
 * Drop consecutive lines that exactly match the original selection when the model
 * interleaves stale and revised lines (common on thinking-capable models).
 */
export function stripInterleavedOriginalLines(output: string, originalText: string): string {
  const originalLines = new Set(
    originalText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
  if (originalLines.size === 0) {
    return output;
  }

  const lines = output.split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed && originalLines.has(trimmed)) {
      const nextTrimmed = lines[i + 1]?.trim() ?? '';
      if (nextTrimmed && !originalLines.has(nextTrimmed)) {
        continue;
      }
    }
    kept.push(lines[i]);
  }
  return kept.join('\n');
}

const REASONING_MONOLOGUE_RE =
  /^\s*(?:the user |i need |i should |i will |let me |thinking(?:\s+process)?\s*:)/i;

/** True when text looks like model reasoning, not insertable code. */
function looksLikeReasoningMonologue(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (
    /[{}();=]|^\s*(const|let|var|function|class|import|export|return|if|for|async|await|def |public |private )\b/m.test(
      trimmed,
    )
  ) {
    return false;
  }
  return REASONING_MONOLOGUE_RE.test(trimmed);
}

/** Remove reasoning blocks and model chatter before editor insertion. */
export function stripEditorModelOutput(
  raw: string,
  options?: { originalText?: string },
): string {
  const split = extractInlineThinkingFromContent(raw);
  let text: string;
  if (split.thinking.length > 0 && split.reply.trim()) {
    // Keep reply indentation — only drop trailing whitespace on the block.
    text = split.reply.replace(/\s+$/, '');
  } else if (split.thinking.length > 0 && !split.reply.trim()) {
    // Thinking block still open or reasoning-only — nothing to insert yet.
    return '';
  } else {
    text = stripInlineThinkingTags(raw).replace(/\s+$/, '');
  }

  if (looksLikeReasoningMonologue(text)) {
    return '';
  }

  if (options?.originalText) {
    text = stripInterleavedOriginalLines(text, options.originalText);
  }
  return text;
}

/** Last-resort code extraction from the reasoning channel (stream end only). */
export function extractEditorCodeFromReasoning(reasoning: string): string {
  const trimmed = reasoning.trim();
  if (!trimmed) return '';

  const fenceMatch = /```[\w-]*\n([\s\S]*?)```/.exec(trimmed);
  if (fenceMatch?.[1]?.trim()) {
    const fromFence = stripEditorModelOutput(fenceMatch[1]);
    if (fromFence && !looksLikeReasoningMonologue(fromFence)) {
      return fromFence;
    }
  }

  const stripped = stripEditorModelOutput(trimmed);
  if (stripped && !looksLikeReasoningMonologue(stripped)) {
    return stripped;
  }

  const codeLines: string[] = [];
  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) {
      if (codeLines.length > 0) break;
      continue;
    }
    if (looksLikeReasoningMonologue(line)) break;
    if (
      /[{}();=]|^\s*(const|let|var|function|class|import|export|return|if|for|async|await|def |public |private )\b/.test(
        line,
      )
    ) {
      codeLines.unshift(line);
    } else if (codeLines.length > 0) {
      break;
    }
  }
  return codeLines.join('\n').trim();
}
