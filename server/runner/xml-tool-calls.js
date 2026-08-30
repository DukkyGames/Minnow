import { extractBalancedJsonObject } from "./harmony-tool-calls.js";
const TOOL_CALL_TAG_NAMES = ["tool_call", "tool_use", "function_call"];
const TOOL_CALL_OPEN_TAGS = TOOL_CALL_TAG_NAMES.map((name) => `<${name}>`);
const TOOL_CALL_CLOSE_TAGS = TOOL_CALL_TAG_NAMES.map((name) => `</${name}>`);
const TOOL_CALL_TAGS = [...TOOL_CALL_OPEN_TAGS, ...TOOL_CALL_CLOSE_TAGS];
const MAX_TOOL_CALL_TAG_LEN = Math.max(...TOOL_CALL_TAGS.map((tag) => tag.length));
const TOOL_CALL_MARKER_RE = new RegExp(`</?(?:${TOOL_CALL_TAG_NAMES.join("|")})>`, "i");
const TOOL_CALL_BLOCK_RE = new RegExp(
  `<(${TOOL_CALL_TAG_NAMES.join("|")})>([\\s\\S]*?)(?:</\\1>|$)`,
  "gi"
);
const CANONICAL_OPEN = `<${TOOL_CALL_TAG_NAMES[0]}>`;
const CANONICAL_CLOSE = `</${TOOL_CALL_TAG_NAMES[0]}>`;
function syntheticXmlToolCallId(index) {
  return `call_xml_${index}`;
}
function isOpenTag(marker) {
  return !marker.startsWith("</");
}
function parseToolCallPayload(inner, index) {
  const json = extractBalancedJsonObject(inner, 0);
  if (!json) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed;
  const fn = record.function;
  let name = typeof record.name === "string" ? record.name.trim() : "";
  let args = record.arguments ?? record.parameters;
  if (fn && typeof fn === "object" && !Array.isArray(fn)) {
    const fnRecord = fn;
    if (!name && typeof fnRecord.name === "string") {
      name = fnRecord.name.trim();
    }
    if (args === void 0) {
      args = fnRecord.arguments ?? fnRecord.parameters;
    }
  }
  if (!name) {
    return null;
  }
  const argumentsJson = typeof args === "string" ? args : args === void 0 ? "{}" : JSON.stringify(args);
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : syntheticXmlToolCallId(index);
  return { id, type: "function", function: { name, arguments: argumentsJson } };
}
function hasXmlToolCallMarkup(text) {
  return Boolean(text) && TOOL_CALL_MARKER_RE.test(text);
}
function tryParseXmlToolCallsFromText(text) {
  if (!text || !hasXmlToolCallMarkup(text)) {
    return [];
  }
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  TOOL_CALL_BLOCK_RE.lastIndex = 0;
  let match = TOOL_CALL_BLOCK_RE.exec(text);
  while (match) {
    const parsed = parseToolCallPayload(match[2] ?? "", out.length);
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
function stripXmlToolCallBlocks(text) {
  if (!text || !hasXmlToolCallMarkup(text)) {
    return text;
  }
  return text.replace(TOOL_CALL_BLOCK_RE, "").trim();
}
function toolCallSuffixHoldLen(text) {
  const limit = Math.min(text.length, MAX_TOOL_CALL_TAG_LEN - 1);
  for (let n = limit; n > 0; n -= 1) {
    const suffix = text.slice(-n).toLowerCase();
    if (!suffix.startsWith("<")) {
      continue;
    }
    if (TOOL_CALL_TAGS.some((tag) => tag.startsWith(suffix))) {
      return n;
    }
  }
  return 0;
}
class ContentToolCallRouter {
  buffer = "";
  capturing = false;
  captured = "";
  /** Literal opener that started the current block, for verbatim replay. */
  capturedOpenTag = "";
  parseText = "";
  /** Visible prose for `text`, with tool-call markup withheld. */
  feed(text) {
    if (!text) {
      return "";
    }
    this.buffer += text;
    return this.drain(false);
  }
  /** Release held bytes; an unterminated block still counts as a call when it parses. */
  flush() {
    return this.drain(true);
  }
  /** Captured `<tool_call>` blocks, re-wrapped canonically for parsing. */
  getToolCallParseText() {
    return this.parseText;
  }
  /** True once a block on this stream parsed as a tool call. */
  hasCapturedToolCalls() {
    return this.parseText.length > 0;
  }
  /**
   * End the current block. Returns text to put back into prose when the payload
   * is not a tool call — a model explaining the format keeps its markup visible.
   */
  closeBlock(closeTag) {
    const raw = this.captured;
    const openTag = this.capturedOpenTag;
    this.captured = "";
    this.capturedOpenTag = "";
    this.capturing = false;
    const inner = raw.trim();
    if (inner && parseToolCallPayload(inner, 0)) {
      this.parseText += `${CANONICAL_OPEN}${inner}${CANONICAL_CLOSE}`;
      return "";
    }
    return `${openTag}${raw}${closeTag}`;
  }
  drain(final) {
    let visible = "";
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
        if (this.capturing) {
          visible += this.closeBlock("");
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
    this.buffer = hold === 0 ? "" : this.buffer.slice(this.buffer.length - hold);
    if (this.capturing) {
      this.captured += emit;
      if (final) {
        return visible + this.closeBlock("");
      }
      return visible;
    }
    return visible + emit;
  }
}
export {
  ContentToolCallRouter,
  hasXmlToolCallMarkup,
  stripXmlToolCallBlocks,
  tryParseXmlToolCallsFromText
};
