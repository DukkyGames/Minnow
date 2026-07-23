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
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Build a short preview string from message body text.
 * @param {string} text
 * @param {number} [maxLen]
 */
export function buildBodyPreview(text, maxLen = 240) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
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
    return text
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
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
