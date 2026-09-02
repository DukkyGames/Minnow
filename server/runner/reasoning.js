/** Coerce provider reasoning fields to a string (`content` / `text` objects, or a part list). */
function coerceReasoningText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(coerceReasoningText).join("");
  }
  if (typeof value === "object") {
    const rec = value;
    if (typeof rec.content === "string") return rec.content;
    if (typeof rec.text === "string") return rec.text;
  }
  return "";
}
function extractReasoningDelta(chunk) {
  const choice = chunk.choices?.[0];
  if (!choice) return "";
  const delta = choice.delta;
  if (!delta) return "";
  const fromDelta = coerceReasoningText(delta.reasoning)
    || coerceReasoningText(delta.reasoning_content)
    || coerceReasoningText(delta.thinking);
  if (fromDelta) return fromDelta;
  const msg = choice.message;
  if (!msg) return "";
  return coerceReasoningText(msg.reasoning)
    || coerceReasoningText(msg.reasoning_content)
    || coerceReasoningText(msg.thinking);
}
function extractReasoningSignatureDelta(chunk) {
  const signature = chunk.choices?.[0]?.delta?.reasoning_signature;
  return typeof signature === "string" ? signature.trim() : "";
}
function extractReasoningMessage(message) {
  if (!message) return "";
  return coerceReasoningText(message.reasoning)
    || coerceReasoningText(message.reasoning_content)
    || coerceReasoningText(message.thinking);
}
function splitThinkingSegments(buffer) {
  const parts = buffer.split(/\n\n+/);
  const out = [];
  for (const p of parts) {
    const t = p.trim();
    if (t) out.push(t);
  }
  return out;
}
function modelRequiresReasoningContentReplay(modelId) {
  return /deepseek/i.test(modelId.trim());
}
function modelRejectsMessageReasoningReplay(modelId) {
  return /kimi|moonshot/i.test(modelId.trim());
}
function outboundReasoningReplayFields(modelId, reasoningText, thinkingSignature, options) {
  const trimmed = reasoningText.trim();
  const out = {};
  if (modelRejectsMessageReasoningReplay(modelId)) {
    return out;
  }
  const deepSeekToolLoop = options?.toolCallTurn === true && modelRequiresReasoningContentReplay(modelId);
  if (deepSeekToolLoop) {
    out.reasoning_content = trimmed;
  } else if (trimmed) {
    if (modelRequiresReasoningContentReplay(modelId)) {
      out.reasoning_content = trimmed;
    } else {
      out.reasoning = trimmed;
    }
  }
  if (thinkingSignature?.trim()) {
    out.reasoning_signature = thinkingSignature.trim();
  }
  return out;
}
export {
  extractReasoningDelta,
  extractReasoningMessage,
  extractReasoningSignatureDelta,
  modelRejectsMessageReasoningReplay,
  modelRequiresReasoningContentReplay,
  outboundReasoningReplayFields,
  splitThinkingSegments
};
