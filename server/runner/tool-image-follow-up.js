const TOOL_IMAGE_FOLLOW_UP_TEXT = "[tool screenshot] Visual result of the preceding tool call. Inspect the image; do not fetch the file URL.";
const TOOL_IMAGE_NO_VISION_HINT = "\n\n(The screenshot file was saved, but the current model cannot view images. Switch to a vision model to inspect the PNG.)";
function isToolImageFollowUpMessage(msg) {
  return msg.role === "user" && msg.toolImageFollowUp === true;
}
function toolImageFollowUpFromAttachments(attachments) {
  if (!attachments?.length) return null;
  const parts = [{ type: "text", text: TOOL_IMAGE_FOLLOW_UP_TEXT }];
  for (const att of attachments) {
    if (att.type !== "image" || typeof att.dataUrl !== "string") continue;
    if (!att.dataUrl.startsWith("data:image/")) continue;
    parts.push({
      type: "image_url",
      image_url: { url: att.dataUrl, detail: "auto" }
    });
  }
  if (parts.length < 2) return null;
  return { role: "user", content: parts, toolImageFollowUp: true };
}
function toolImageFollowUpUserMessage(message) {
  if (message.role !== "tool") return null;
  return toolImageFollowUpFromAttachments(message.attachments);
}
function toolMessageHasImageAttachment(message) {
  if (message.role !== "tool" || !message.attachments?.length) return false;
  return message.attachments.some((att) => att.type === "image");
}
const USER_IMAGE_NO_VISION_HINT = "\n\n(The user attached the image(s) named above, but the current model cannot accept image input, so the pixels were not sent. There is no tool that can read them \u2014 say you cannot see the image and suggest switching to a vision model.)";
export {
  TOOL_IMAGE_FOLLOW_UP_TEXT,
  TOOL_IMAGE_NO_VISION_HINT,
  USER_IMAGE_NO_VISION_HINT,
  isToolImageFollowUpMessage,
  toolImageFollowUpFromAttachments,
  toolImageFollowUpUserMessage,
  toolMessageHasImageAttachment
};
