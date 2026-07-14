/**
 * Redact sensitive paths and secrets from diagnostic export payloads.
 */

import os from 'node:os';
import path from 'node:path';
import { sanitizeError } from '../webhooks/ssrf.js';

/** Patterns that indicate secret material in free text. */
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi,
  /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
];

/** Home directory prefixes to anonymize (user + minnow home). */
function homePrefixes() {
  const prefixes = new Set();
  const homedir = os.homedir();
  if (homedir) prefixes.add(path.resolve(homedir));
  const minnowHome =
    typeof process.env.MINNOW_HOME === 'string' && process.env.MINNOW_HOME.trim()
      ? path.resolve(process.env.MINNOW_HOME.trim())
      : homedir
        ? path.join(homedir, '.minnow')
        : '';
  if (minnowHome) prefixes.add(minnowHome);
  return [...prefixes].sort((a, b) => b.length - a.length);
}

/**
 * Replace absolute home paths with $HOME / $MINNOW_HOME tokens.
 * @param {string} text
 */
export function redactPaths(text) {
  let out = String(text ?? '');
  for (const prefix of homePrefixes()) {
    if (!prefix) continue;
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const token = prefix.endsWith('.minnow') ? '$MINNOW_HOME' : '$HOME';
    out = out.replace(new RegExp(escaped, 'g'), token);
  }
  return out;
}

/**
 * Redact secrets, IPs, URLs, and home paths from one string.
 * @param {string} text
 * @param {number} [maxLen]
 */
export function redactDiagnosticText(text, maxLen = 4000) {
  let cleaned = redactPaths(String(text ?? ''));
  for (const pattern of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[redacted-secret]');
  }
  cleaned = sanitizeError(cleaned, maxLen);
  return cleaned.slice(0, maxLen);
}

/**
 * Deep-redact unknown JSON values for export.
 * @param {unknown} value
 */
export function redactDiagnosticValue(value) {
  if (value == null) return value;
  if (typeof value === 'string') return redactDiagnosticText(value);
  if (Array.isArray(value)) return value.map((v) => redactDiagnosticValue(v));
  if (typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/secret|token|password|apikey|api_key/i.test(k)) {
        out[k] = '[redacted]';
      } else {
        out[k] = redactDiagnosticValue(v);
      }
    }
    return out;
  }
  return value;
}

/**
 * Build a markdown diagnostic report bundle (redacted).
 * @param {{
 *   version?: string;
 *   platform?: string;
 *   nodeVersion?: string;
 *   electronVersion?: string | null;
 *   health?: Record<string, unknown>;
 *   errors?: Array<Record<string, unknown>>;
 *   logLines?: Array<Record<string, unknown>>;
 * }} input
 */
export function formatDiagnosticReportMarkdown(input) {
  const lines = [
    '# Minnow diagnostic report',
    '',
    '## Environment',
    `- App version: ${input.version ?? 'unknown'}`,
    `- Platform: ${input.platform ?? process.platform}`,
    `- Node: ${input.nodeVersion ?? process.version}`,
  ];
  if (input.electronVersion) {
    lines.push(`- Electron: ${input.electronVersion}`);
  }
  lines.push('');

  if (input.health) {
    lines.push('## Health');
    lines.push('```json');
    lines.push(JSON.stringify(redactDiagnosticValue(input.health), null, 2));
    lines.push('```');
    lines.push('');
  }

  if (input.errors?.length) {
    lines.push('## Recent errors (grouped)');
    for (const group of input.errors) {
      const sig = redactDiagnosticText(String(group.signature ?? group.message ?? 'error'));
      const count = group.count ?? 1;
      lines.push(`### ${sig} (×${count})`);
      if (group.lastAt) lines.push(`- Last: ${group.lastAt}`);
      if (group.source) lines.push(`- Source: ${group.source}`);
      if (group.stack) {
        lines.push('```');
        lines.push(redactDiagnosticText(String(group.stack), 2000));
        lines.push('```');
      }
      lines.push('');
    }
  }

  if (input.logLines?.length) {
    lines.push('## Last log lines');
    lines.push('```');
    for (const entry of input.logLines.slice(-50)) {
      lines.push(redactDiagnosticText(JSON.stringify(entry), 500));
    }
    lines.push('```');
  }

  return lines.join('\n');
}
