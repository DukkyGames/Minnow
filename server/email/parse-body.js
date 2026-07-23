/** Named HTML entities that appear in marketing mail (invisible / spacing). */
const NAMED_HTML_ENTITIES = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  shy: '',
  zwnj: '',
  zwj: '',
};

/** Invisible / format characters marketing HTML uses to break spam filters. */
const INVISIBLE_PREVIEW_CHARS =
  /[\u200B-\u200D\uFEFF\u00AD\u2060\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200E\u200F\u202A-\u202E\u2061-\u2064\u2066-\u2069\u3164]/g;

/**
 * Decode numeric and common named HTML entities left after tag stripping.
 * @param {string} text
 */
export function decodeHtmlEntities(text) {
  return String(text ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      const cp = parseInt(hex, 16);
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : _match;
    })
    .replace(/&#(\d+);/g, (_match, dec) => {
      const cp = parseInt(dec, 10);
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : _match;
    })
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_HTML_ENTITIES[name.toLowerCase()] ?? match);
}

/**
 * Repair UTF-8 bytes that were stored as Latin-1 code units (common after a
 * byte-wise quoted-printable decode of UTF-8 marketing mail).
 * @param {string} text
 */
export function repairUtf8Mojibake(text) {
  const raw = String(text ?? '');
  if (!raw) return '';
  try {
    const repaired = Buffer.from(raw, 'latin1').toString('utf8');
    if (repaired !== raw && !repaired.includes('\uFFFD')) {
      return repaired;
    }
  } catch {
    /* keep original */
  }
  return raw;
}

/**
 * Normalize preview/snippet text for list rows: repair mojibake, drop invisible
 * characters, collapse whitespace.
 * @param {string} text
 */
export function sanitizePreviewText(text) {
  let clean = repairUtf8Mojibake(String(text ?? ''));
  clean = decodeHtmlEntities(clean);
  clean = clean.replace(INVISIBLE_PREVIEW_CHARS, '');
  return clean.replace(/\s+/g, ' ').trim();
}

/**
 * Strip HTML tags and collapse whitespace for email body previews.
 * @param {string} html
 */
export function stripHtmlToText(html) {
  let text = String(html ?? '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeHtmlEntities(text);
  return sanitizePreviewText(text);
}

/**
 * Build a short preview string from message body text.
 * @param {string} text
 * @param {number} [maxLen]
 */
export function buildBodyPreview(text, maxLen = 240) {
  const clean = sanitizePreviewText(text);
  if (clean.length <= maxLen) {
    return clean;
  }
  return `${clean.slice(0, maxLen - 1)}…`;
}

/**
 * Decode a MIME body part buffer according to Content-Transfer-Encoding.
 *
 * IMAP `BODY[n]` returns the raw part bytes — still base64 or quoted-printable
 * when that is how the sender encoded it. Sync must decode before storing a
 * preview or the reader shows garbled text.
 *
 * @param {Buffer | string | null | undefined} raw
 * @param {string | undefined} encoding — from bodyStructure.encoding
 */
export function decodeBodyPart(raw, encoding) {
  if (raw == null) return '';
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'binary');
  const enc = String(encoding ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');

  if (enc === 'base64' || enc === 'b') {
    try {
      const stripped = buffer.toString('ascii').replace(/\s+/g, '');
      if (!stripped) return '';
      return Buffer.from(stripped, 'base64').toString('utf8');
    } catch {
      return buffer.toString('utf8');
    }
  }

  if (enc === 'quoted-printable' || enc === 'qp' || enc === 'q') {
    const text = buffer.toString('binary');
    const decoded = text
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
    // QP gives raw bytes — reassemble as UTF-8 instead of Latin-1 code units.
    return Buffer.from(decoded, 'binary').toString('utf8');
  }

  return buffer.toString('utf8');
}

/**
 * Decode RFC 2047 encoded words in a header value.
 * @param {string | undefined} value
 */
export function decodeMimeHeader(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  // Minimal encoded-word decode: =?charset?Q?...?= / =?charset?B?...?=
  return raw.replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_match, _charset, encoding, payload) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        return Buffer.from(payload, 'base64').toString('utf8');
      }
      const q = payload
        .replace(/_/g, ' ')
        .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) =>
          String.fromCharCode(parseInt(hex, 16)),
        );
      return q;
    } catch {
      return payload;
    }
  });
}

/**
 * Format an address list from IMAP envelope data.
 * @param {Array<{ name?: string, address?: string }> | undefined} list
 */
export function formatAddressList(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return [];
  }
  return list.map((entry) => {
    const name = decodeMimeHeader(entry.name);
    const address = String(entry.address ?? '').trim();
    if (name && address) {
      return `${name} <${address}>`;
    }
    return address || name || '';
  });
}

/**
 * @param {Array<{ name?: string, address?: string }> | undefined} list
 */
export function formatFromAddress(list) {
  const formatted = formatAddressList(list);
  return formatted[0] ?? '';
}
