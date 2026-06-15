/**
 * Plain-text extraction for TTS read-aloud (no UI dependencies).
 */

/** Strip markdown-ish content to plain speech text. */
export function extractSpeechText(content: string): string {
  let cleaned = content.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  cleaned = cleaned.replace(/```[\s\S]*?```/g, ' ');
  cleaned = cleaned.replace(/`[^`]+`/g, ' ');
  cleaned = cleaned.replace(/!\[[^\]]*]\([^)]+\)/g, ' ');
  cleaned = cleaned.replace(/\[([^\]]+)]\([^)]+\)/g, '$1');
  cleaned = cleaned.replace(/[#>*_~\-]+/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}
