/**
 * Parse and stream-route XML-tagged tool calls embedded in assistant `content`.
 *
 * Qwen-family chat templates (and the mlx-lm / llama.cpp servers that serve them)
 * emit `<tool_call>{"name":…,"arguments":{…}}</tool_call>` as plain content instead
 * of OpenAI `delta.tool_calls`. Without this the block is rendered as prose, no tool
 * ever runs, and the model retries until the generation buffer overflows.
 */

import type { ToolCall } from '../types';
import { extractBalancedJsonObject } from './harmony-tool-calls';

/** Wrapper tags local runtimes use around a JSON tool call in `content`. */
const TOOL_CALL_TAG_NAMES = ['tool_call', 'tool_use', 'function_call'] as const;

const TOOL_CALL_OPEN_TAGS = TOOL_CALL_TAG_NAMES.map((name) => `<${name}>`);
const TOOL_CALL_CLOSE_TAGS = TOOL_CALL_TAG_NAMES.map((name) => `</${name}>`);
const TOOL_CALL_TAGS = [...TOOL_CALL_OPEN_TAGS, ...TOOL_CALL_CLOSE_TAGS];
const MAX_TOOL_CALL_TAG_LEN = Math.max(...TOOL_CALL_TAGS.map((tag) => tag.length));

const TOOL_CALL_MARKER_RE = new RegExp(`</?(?:${TOOL_CALL_TAG_NAMES.join('|')})>`, 'i');
const TOOL_CALL_BLOCK_RE = new RegExp(
  `<(${TOOL_CALL_TAG_NAMES.join('|')})>([\\s\\S]*?)(?:</\\1>|$)`,
  'gi',
);

/** Canonical wrapper used when handing captured blocks to the parser. */
const CANONICAL_OPEN = `<${TOOL_CALL_TAG_NAMES[0]}>`;
const CANONICAL_CLOSE = `</${TOOL_CALL_TAG_NAMES[0]}>`;

/** Generate stable synthetic ids for tool rows parsed from tagged content. */
function syntheticXmlToolCallId(index: number): string {
  return `call_xml_${index}`;
}

function isOpenTag(marker: string): boolean {
  return !marker.startsWith('</');
}

/** Read `name` + `arguments`/`parameters` out of one `<tool_call>` payload. */
function parseToolCallPayload(inner: string, index: number): ToolCall | null {
  const json = extractBalancedJsonObject(inner, 0);
  if (!json) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const fn = record.function;
  let name = typeof record.name === 'string' ? record.name.trim() : '';
  let args: unknown = record.arguments ?? record.parameters;
  if (fn && typeof fn === 'object' && !Array.isArray(fn)) {
    const fnRecord = fn as Record<string, unknown>;
    if (!name && typeof fnRecord.name === 'string') {
      name = fnRecord.name.trim();
    }
    if (args === undefined) {
      args = fnRecord.arguments ?? fnRecord.parameters;
    }
  }
  if (!name) {
    return null;
  }

  const argumentsJson =
    typeof args === 'string' ? args : args === undefined ? '{}' : JSON.stringify(args);
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : syntheticXmlToolCallId(index);
  return { id, type: 'function', function: { name, arguments: argumentsJson } };
}

/** True when the text carries at least one XML-tagged tool call opener. */
export function hasXmlToolCallMarkup(text: string): boolean {
  return Boolean(text) && TOOL_CALL_MARKER_RE.test(text);
}

/**
 * Parse every `<tool_call>…</tool_call>` block in assistant text.
 * An unterminated trailing block is still parsed so a stream cut at the close tag works.
 */
export function tryParseXmlToolCallsFromText(text: string): ToolCall[] {
  if (!text || !hasXmlToolCallMarkup(text)) {
    return [];
  }

  const out: ToolCall[] = [];
  const seen = new Set<string>();
  TOOL_CALL_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null = TOOL_CALL_BLOCK_RE.exec(text);
  while (match) {
    const parsed = parseToolCallPayload(match[2] ?? '', out.length);
    if (parsed) {
      const dedupeKey = `${parsed.function.name}\0${parsed.function.arguments}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        out.push(parsed);
      }
    }
    match = TOOL_CALL_BLOCK_RE.exec(text);
  }
  return out;
}

/** Drop `<tool_call>` blocks from prose that was captured before routing existed. */
export function stripXmlToolCallBlocks(text: string): string {
  if (!text || !hasXmlToolCallMarkup(text)) {
    return text;
  }
  return text.replace(TOOL_CALL_BLOCK_RE, '').trim();
}

function toolCallSuffixHoldLen(text: string): number {
  const limit = Math.min(text.length, MAX_TOOL_CALL_TAG_LEN - 1);
  for (let n = limit; n > 0; n -= 1) {
    const suffix = text.slice(-n).toLowerCase();
    if (!suffix.startsWith('<')) {
      continue;
    }
    if (TOOL_CALL_TAGS.some((tag) => tag.startsWith(suffix))) {
      return n;
    }
  }
  return 0;
}

/**
 * Stateful splitter that keeps `<tool_call>` payloads out of the visible reply.
 * Feed it the non-thinking parts of the content stream; the captured blocks are
 * exposed via {@link getToolCallParseText} for post-stream tool-call parsing.
 */
export class ContentToolCallRouter {
  private buffer = '';

  private capturing = false;

  private captured = '';

  /** Literal opener that started the current block, for verbatim replay. */
  private capturedOpenTag = '';

  private parseText = '';

  /** Visible prose for `text`, with tool-call markup withheld. */
  feed(text: string): string {
    if (!text) {
      return '';
    }
    this.buffer += text;
    return this.drain(false);
  }

  /** Release held bytes; an unterminated block still counts as a call when it parses. */
  flush(): string {
    return this.drain(true);
  }

  /** Captured `<tool_call>` blocks, re-wrapped canonically for parsing. */
  getToolCallParseText(): string {
    return this.parseText;
  }

  /** True once a block on this stream parsed as a tool call. */
  hasCapturedToolCalls(): boolean {
    return this.parseText.length > 0;
  }

  /**
   * End the current block. Returns text to put back into prose when the payload
   * is not a tool call — a model explaining the format keeps its markup visible.
   */
  private closeBlock(closeTag: string): string {
    const raw = this.captured;
    const openTag = this.capturedOpenTag;
    this.captured = '';
    this.capturedOpenTag = '';
    this.capturing = false;
    const inner = raw.trim();
    if (inner && parseToolCallPayload(inner, 0)) {
      this.parseText += `${CANONICAL_OPEN}${inner}${CANONICAL_CLOSE}`;
      return '';
    }
    return `${openTag}${raw}${closeTag}`;
  }

  private drain(final: boolean): string {
    let visible = '';
    while (true) {
      const match = TOOL_CALL_MARKER_RE.exec(this.buffer);
      if (!match) {
        break;
      }
      const before = this.buffer.slice(0, match.index);
      if (this.capturing) {
        this.captured += before;
      } else {
        visible += before;
      }
      this.buffer = this.buffer.slice(match.index + match[0].length);

      if (isOpenTag(match[0])) {
        // A nested opener means the model never closed the previous block.
        if (this.capturing) {
          visible += this.closeBlock('');
        }
        this.capturing = true;
        this.capturedOpenTag = match[0];
        continue;
      }
      if (this.capturing) {
        visible += this.closeBlock(match[0]);
      } else {
        visible += match[0];
      }
    }

    const hold = final ? 0 : toolCallSuffixHoldLen(this.buffer);
    const emit = hold === 0 ? this.buffer : this.buffer.slice(0, this.buffer.length - hold);
    this.buffer = hold === 0 ? '' : this.buffer.slice(this.buffer.length - hold);

    if (this.capturing) {
      this.captured += emit;
      if (final) {
        return visible + this.closeBlock('');
      }
      return visible;
    }
    return visible + emit;
  }
}
