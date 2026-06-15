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
