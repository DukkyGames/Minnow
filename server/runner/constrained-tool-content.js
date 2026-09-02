import { tryParseHarmonyToolCallsFromText } from "./harmony-tool-calls.js";
import { tryParseXmlToolCallsFromText } from "./xml-tool-calls.js";
function syntheticToolCallId(index) {
  return `call_content_${index}`;
}
function tryParseToolCallsFromAssistantContent(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.includes('"tool_calls"')) {
    return [];
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const rawCalls = parsed.tool_calls;
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) {
    return [];
  }
  const out = [];
  for (let i = 0; i < rawCalls.length; i++) {
    const row = rawCalls[i];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const rec = row;
    const fn = rec.function;
    let name = typeof rec.name === "string" ? rec.name.trim() : "";
    let args = rec.arguments;
    if (fn && typeof fn === "object" && !Array.isArray(fn)) {
      const f = fn;
      if (!name && typeof f.name === "string") {
        name = f.name.trim();
      }
      if (args === void 0 && "arguments" in f) {
        args = f.arguments;
      }
    }
    if (!name) {
      continue;
    }
    const argStr = typeof args === "string" ? args : args === void 0 ? "{}" : JSON.stringify(args);
    out.push({
      id: typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : syntheticToolCallId(i),
      type: "function",
      function: { name, arguments: argStr }
    });
  }
  return out;
}
function isEmptyToolArgumentsJson(argumentsRaw) {
  const trimmed = argumentsRaw.trim();
  if (!trimmed) return true;
  if (trimmed === "{}") return true;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return true;
    }
    return Object.keys(parsed).length === 0;
  } catch {
    return false;
  }
}
function toolArgumentsRichnessScore(argumentsRaw) {
  const trimmed = argumentsRaw.trim();
  if (!trimmed || trimmed === "{}") return 0;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return trimmed.length;
    }
    const record = parsed;
    let score = Object.keys(record).length * 100;
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        score += value.length * 10;
      } else if (typeof value === "string") {
        if (value.startsWith("[") || value.startsWith("{")) {
          score += Math.min(value.length, 500);
        } else {
          score += Math.min(value.length, 50);
        }
      }
    }
    return score + Math.min(trimmed.length, 1e3);
  } catch {
    return trimmed.length;
  }
}
function pickRicherToolArguments(streamedRaw, contentRaw) {
  const streamEmpty = isEmptyToolArgumentsJson(streamedRaw);
  const contentEmpty = isEmptyToolArgumentsJson(contentRaw);
  if (streamEmpty && !contentEmpty) return contentRaw;
  if (contentEmpty && !streamEmpty) return streamedRaw;
  if (streamEmpty && contentEmpty) return streamedRaw;
  const streamScore = toolArgumentsRichnessScore(streamedRaw);
  const contentScore = toolArgumentsRichnessScore(contentRaw);
  if (contentScore > streamScore) return contentRaw;
  if (streamScore > contentScore) return streamedRaw;
  return streamedRaw;
}
function mergeStreamedWithContentToolCalls(streamed, fromContent) {
  if (fromContent.length === 0) {
    return streamed;
  }
  return streamed.map((tc, index) => {
    const byName = fromContent.find((c) => c.function.name === tc.function.name);
    const contentMatch = byName ?? fromContent[index];
    if (!contentMatch) {
      return tc;
    }
    const argumentsJson = pickRicherToolArguments(
      tc.function.arguments,
      contentMatch.function.arguments
    );
    if (argumentsJson === tc.function.arguments) {
      return tc;
    }
    return {
      ...tc,
      function: {
        ...tc.function,
        arguments: argumentsJson
      }
    };
  });
}
function mergeContentJsonToolCalls(fullText, streamed, options) {
  const harmonyHaystack = [options?.harmonyParseText, fullText].filter((part) => Boolean(part?.trim())).join("\n");
  const fromHarmony = tryParseHarmonyToolCallsFromText(harmonyHaystack);
  const xmlHaystack = [options?.xmlParseText, fullText].filter((part) => Boolean(part?.trim())).join("\n");
  const fromXml = tryParseXmlToolCallsFromText(xmlHaystack);
  const fromContent = tryParseToolCallsFromAssistantContent(fullText);
  if (streamed.length === 0) {
    if (fromHarmony.length > 0) {
      return fromHarmony;
    }
    if (fromXml.length > 0) {
      return fromXml;
    }
    if (fromContent.length > 0) {
      return fromContent;
    }
    const thinkingHaystack = options?.thinkingXmlParseText ?? "";
    const fromThinkingXml = tryParseXmlToolCallsFromText(thinkingHaystack);
    if (fromThinkingXml.length > 0) {
      return fromThinkingXml;
    }
    // Constrained-decoding JSON that landed on the reasoning channel (MTPLX).
    return tryParseToolCallsFromAssistantContent(thinkingHaystack);
  }
  const contentFallback = fromHarmony.length > 0 ? fromHarmony : fromXml.length > 0 ? fromXml : fromContent;
  return mergeStreamedWithContentToolCalls(streamed, contentFallback);
}
export {
  isEmptyToolArgumentsJson,
  mergeContentJsonToolCalls,
  toolArgumentsRichnessScore,
  tryParseToolCallsFromAssistantContent
};
