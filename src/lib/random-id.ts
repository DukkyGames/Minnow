/**
 * RFC 4122 UUID v4 for browser and test environments.
 * crypto.randomUUID() is secure-context-only (HTTPS / localhost); LAN http://192.168.x.x is not.
 * crypto.getRandomValues() works outside secure contexts and is used as the primary fallback.
 */

/** Generate a random UUID v4 string. */
export function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const fromBytes = randomUUIDFromGetRandomValues();
  if (fromBytes) return fromBytes;
  return randomUUIDFromMathRandom();
}

/** Build UUID v4 from getRandomValues when randomUUID is unavailable. */
function randomUUIDFromGetRandomValues(): string | null {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    return null;
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Last-resort UUID v4 when Web Crypto is entirely missing (e.g. some test stubs). */
function randomUUIDFromMathRandom(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
