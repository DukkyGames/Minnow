function extractReasoningDelta(chunk) {
  const choice = chunk.choices?.[0];
  if (!choice) return "";
  const delta = choice.delta;
  if (!delta) return "";
  if (delta.reasoning) return delta.reasoning;
  if (delta.reasoning_content) return delta.reasoning_content;
  if (delta.thinking) return delta.thinking;
  const msg = choice.message;
  if (msg?.reasoning) return msg.reasoning;
  if (msg?.reasoning_content) return msg.reasoning_content;
  const msgThinking = msg?.thinking;
  if (msgThinking) return msgThinking;
  return "";
}
function extractReasoningSignatureDelta(chunk) {
  const signature = chunk.choices?.[0]?.delta?.reasoning_signature;
  return typeof signature === "string" ? signature.trim() : "";
}
function extractReasoningMessage(message) {
  if (!message) return "";
  if (message.reasoning) return message.reasoning;
  if (message.reasoning_content) return message.reasoning_content;
  if (message.thinking) return message.thinking;
  return "";
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
