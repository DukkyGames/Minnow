function contentPartsToText(parts) {
  let out = "";
  for (const part of parts) {
    if (part.type === "text") {
      out += part.text;
      continue;
    }
    if (part.type === "image_url") {
      out += "[image]";
    }
  }
  return out;
}
function apiMessageContentToText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return contentPartsToText(content);
  return "";
}
function streamDeltaContentToText(raw) {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    let out = "";
    for (const item of raw) {
      out += streamDeltaContentToText(item);
    }
    return out;
  }
  if (typeof raw === "object") {
    const part = raw;
    if (part.type === "text" && typeof part.text === "string") {
      return part.text;
    }
    if (typeof part.text === "string") {
      return part.text;
    }
    if (typeof part.content === "string") {
      return part.content;
    }
  }
  return "";
}
class StreamingContentAccumulator {
  parts = /* @__PURE__ */ new Map();
  /** Apply one SSE choice's delta or message content. */
  ingestChoice(choice) {
    if (!choice) return;
    if (choice.delta?.content !== void 0 && choice.delta.content !== null) {
      this.ingestContent(choice.delta.content);
      return;
    }
    if (choice.message?.content !== void 0 && choice.message.content !== null) {
      this.ingestContent(choice.message.content);
    }
  }
  /** Join merged parts in index order. */
  getText() {
    const indices = [...this.parts.keys()].sort((a, b) => a - b);
    return indices.map((i) => this.parts.get(i) ?? "").join("");
  }
  ingestContent(raw) {
    if (raw == null) return;
    if (typeof raw === "string") {
      this.appendToPart(0, raw);
      return;
    }
    if (Array.isArray(raw)) {
      for (const item of raw) {
        this.ingestPartItem(item);
      }
      return;
    }
    this.ingestPartItem(raw);
  }
  ingestPartItem(item) {
    if (item == null) return;
    if (typeof item === "string") {
      this.appendToPart(0, item);
      return;
    }
    if (typeof item !== "object") return;
    const part = item;
    const index = typeof part.index === "number" ? part.index : 0;
    const text = streamDeltaContentToText(part);
    if (!text) return;
    const prev = this.parts.get(index) ?? "";
    if (text.startsWith(prev) && text.length > prev.length) {
      this.parts.set(index, text);
      return;
    }
    if (prev.startsWith(text)) {
      return;
    }
    this.appendToPart(index, text);
  }
  appendToPart(index, text) {
    this.parts.set(index, (this.parts.get(index) ?? "") + text);
  }
}
export {
  StreamingContentAccumulator,
  apiMessageContentToText,
  contentPartsToText,
  streamDeltaContentToText
};
