const HARMONY_TOOL_NAME_PREFIXES = [
  "functions.",
  "repo_browser.",
  "browser.",
  "tools."
];
function syntheticHarmonyToolCallId(index) {
  return `call_harmony_${index}`;
}
function normalizeHarmonyToolName(raw) {
  let name = raw.trim();
  if (!name) {
    return "";
  }
  for (const prefix of HARMONY_TOOL_NAME_PREFIXES) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }
  return name;
}
function extractBalancedJsonObject(text, startIndex) {
  const braceStart = text.indexOf("{", startIndex);
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
      if (ch === "\\") {
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
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(braceStart, i + 1);
      }
    }
  }
  return null;
}
function findHarmonyToolCallMatch(segment) {
  const toMatch = /\bto=([^\s<|]+)/i.exec(segment);
  if (!toMatch) {
    return null;
  }
  const name = normalizeHarmonyToolName(toMatch[1] ?? "");
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
function tryParseHarmonyToolCallsFromText(text) {
  if (!text || !/\bto=/i.test(text)) {
    return [];
  }
  const segments = [];
  const commentaryRe = /<\|channel\|>commentary/gi;
  let match = commentaryRe.exec(text);
  if (match) {
    while (match) {
      const start = match.index;
      const next = commentaryRe.exec(text);
      const end = next ? next.index : text.length;
      segments.push(text.slice(start, end));
      match = next;
    }
  } else if (/<\|channel\|>/i.test(text)) {
    segments.push(text);
  } else {
    segments.push(text);
  }
  const out = [];
  const seen = /* @__PURE__ */ new Set();
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
      argStr = JSON.stringify(JSON.parse(parsed.argsJson));
    } catch {
    }
    const index = out.length;
    out.push({
      id: syntheticHarmonyToolCallId(index),
      type: "function",
      function: { name: parsed.name, arguments: argStr }
    });
  }
  return out;
}
export {
  extractBalancedJsonObject,
  normalizeHarmonyToolName,
  tryParseHarmonyToolCallsFromText
};
