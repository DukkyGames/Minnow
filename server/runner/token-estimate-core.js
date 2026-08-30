import { outboundReasoningReplayFields } from "./reasoning.js";
import { isUiOnlyTranscriptMessage } from "./injection-notice.js";
import { toolImageFollowUpUserMessage } from "./tool-image-follow-up.js";
function replayedReasoningFields(m, options) {
  if (!options?.replayPriorReasoning) return null;
  const reasoningText = m.thinking?.join("\n\n").trim() ?? "";
  if (!reasoningText) return null;
  const fields = outboundReasoningReplayFields(options.modelId ?? "", reasoningText);
  return Object.keys(fields).length > 0 ? fields : null;
}
const CHARS_PER_TOKEN = {
  prose: 3.6,
  payload: 3,
  schema: 4
};
function charsPerTokenFor(kind) {
  return CHARS_PER_TOKEN[kind];
}
function estimateTokensFromText(text, kind = "prose") {
  if (!text) return 0;
  return Math.round(text.length / CHARS_PER_TOKEN[kind]);
}
const ESTIMATE_IMAGE_URL_TOKENS = 256;
function imagePaddingForEstimate(imageCount) {
  if (imageCount <= 0) return "";
  return " ".repeat(
    Math.round(imageCount * ESTIMATE_IMAGE_URL_TOKENS * CHARS_PER_TOKEN.prose)
  );
}
function formatTokenEstimateLabel(tokens) {
  if (!Number.isFinite(tokens) || tokens < 0) return "\u2014";
  if (tokens >= 1e3) {
    return `~${(tokens / 1e3).toFixed(1)}k tokens (estimate)`;
  }
  return `~${tokens.toLocaleString()} tokens (estimate)`;
}
const TOKEN_ESTIMATE_TOOLTIP = "Approximate size from character counts calibrated per content type. Real prompt tokens depend on the model tokenizer. Excludes pending composer text and attachments.";
const SETTINGS_PROMPT_CONFIG_ESTIMATE_TOOLTIP = "Approximate system prompt, rules, and tools from character counts calibrated per content type. Excludes chat history, pending composer text, and attachments.";
function historyToApiMessagesForEstimate(history, options) {
  const messages = [];
  for (const m of history) {
    if (isUiOnlyTranscriptMessage(m)) continue;
    if (m.role === "user") {
      const images = m.images ?? [];
      if (images.length > 0) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: m.content },
            ...images.map((image) => ({
              type: "image_url",
              image_url: { url: image.dataUrl, detail: "auto" }
            }))
          ]
        });
        continue;
      }
      messages.push({ role: "user", content: m.content });
      continue;
    }
    if (m.role === "tool") {
      messages.push({
        role: "tool",
        tool_call_id: m.tool_call_id,
        content: m.content
      });
      const followUp = toolImageFollowUpUserMessage(m);
      if (followUp) messages.push(followUp);
      continue;
    }
    if (m.role === "assistant") {
      const withTools = m;
      if (withTools.tool_calls?.length) {
        messages.push({
          role: "assistant",
          content: withTools.content ?? null,
          tool_calls: withTools.tool_calls
        });
      } else {
        const replayed = replayedReasoningFields(m, options);
        messages.push({
          role: "assistant",
          content: m.content,
          ...replayed ?? {}
        });
      }
    }
  }
  return messages;
}
function serializeMessageContentForEstimate(m, options) {
  if (m.role === "user") {
    const imageCount = m.images?.length ?? 0;
    if (imageCount === 0) return m.content;
    return m.content + imagePaddingForEstimate(imageCount);
  }
  if (m.role === "tool") return m.content;
  if (m.role === "assistant") {
    const withTools = m;
    if (withTools.tool_calls?.length) {
      const content = withTools.content ?? "";
      return content + JSON.stringify(withTools.tool_calls);
    }
    const replayed = replayedReasoningFields(m, options);
    return (m.content ?? "") + (replayed ? JSON.stringify(replayed) : "");
  }
  return "";
}
function estimateMessageTokens(m, options) {
  if (m.role === "user") {
    const images = m.images?.length ?? 0;
    return estimateTokensFromText(m.content, "prose") + images * ESTIMATE_IMAGE_URL_TOKENS;
  }
  if (m.role === "tool") return estimateTokensFromText(m.content, "payload");
  if (m.role === "assistant") {
    const withTools = m;
    let total = estimateTokensFromText(withTools.content ?? "", "prose");
    if (withTools.tool_calls?.length) {
      return total + estimateTokensFromText(JSON.stringify(withTools.tool_calls), "payload");
    }
    const replayed = replayedReasoningFields(m, options);
    if (replayed) total += estimateTokensFromText(JSON.stringify(replayed), "prose");
    return total;
  }
  return 0;
}
function estimateHistoryTokens(history, options) {
  let total = 0;
  for (const m of history) {
    if (isUiOnlyTranscriptMessage(m)) continue;
    total += estimateMessageTokens(m, options);
  }
  return total;
}
function estimateToolsTokens(tools) {
  if (tools.length === 0) return 0;
  return estimateTokensFromText(JSON.stringify(tools), "schema");
}
function computePromptConfigTokenTotal(est) {
  return est.composedSystem + est.userRules + est.tools;
}
function computeOutboundPromptEstimateFromParts(parts) {
  const composedSystem = estimateTokensFromText(parts.systemText.trim());
  const userRules = estimateTokensFromText(parts.userRulesText?.trim() ?? "");
  const history = estimateHistoryTokens(parts.history);
  const tools = estimateToolsTokens(parts.tools);
  return {
    total: composedSystem + userRules + history + tools,
    composedSystem,
    userRules,
    history,
    tools,
    legacyFallback: parts.legacyFallback === true
  };
}
export {
  ESTIMATE_IMAGE_URL_TOKENS,
  SETTINGS_PROMPT_CONFIG_ESTIMATE_TOOLTIP,
  TOKEN_ESTIMATE_TOOLTIP,
  charsPerTokenFor,
  computeOutboundPromptEstimateFromParts,
  computePromptConfigTokenTotal,
  estimateHistoryTokens,
  estimateMessageTokens,
  estimateTokensFromText,
  estimateToolsTokens,
  formatTokenEstimateLabel,
  historyToApiMessagesForEstimate,
  imagePaddingForEstimate,
  serializeMessageContentForEstimate
};
