/** Validate LM Studio base URL before network calls. */
export function parseServerBaseUrl(raw: string): string | null {
  const trimmed = (raw || '').trim().replace(/\/$/, '');
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}
