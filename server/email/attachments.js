/**
 * Attachment metadata helpers for email triage context.
 */

import { getCachedMessage } from './cache.js';

/**
 * Summarize attachment metadata for LLM context (no binary content).
 * @param {Array<{ filename?: string, size?: number, contentType?: string }>} attachments
 */
export function summarizeAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return '';
  }
  const lines = attachments.map((att) => {
    const name = String(att.filename ?? 'attachment');
    const size = Number(att.size) || 0;
    const type = String(att.contentType ?? 'application/octet-stream');
    return `- ${name} (${type}, ${size} bytes)`;
  });
  return `Attachments:\n${lines.join('\n')}`;
}

/**
 * Load attachment summary for a cached message.
 * @param {string} accountId
 * @param {string} messageKey
 */
export async function getAttachmentSummaryForMessage(accountId, messageKey) {
  const message = await getCachedMessage(accountId, messageKey);
  if (!message) {
    return '';
  }
  return summarizeAttachments(
    /** @type {Array<{ filename?: string, size?: number, contentType?: string }>} */ (
      message.attachments
    ),
  );
}
