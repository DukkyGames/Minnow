const ENTITY_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

export const RESERVED_EXPERT_IDS = new Set([
  'general',
  '_template',
  '_example',
  '_example-expert',
]);

/** Slugify a human label into a valid expert id. */
export function slugifyExpertLabel(label: string): string {
  let slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);

  if (!slug || !/^[a-z]/.test(slug)) {
    slug = `expert-${slug || 'custom'}`.replace(/^-+/, '').slice(0, 63);
  }
  if (!ENTITY_ID_RE.test(slug)) {
    return 'expert-custom';
  }
  return slug;
}

/** Pick a unique id against existing expert ids. */
export function dedupeExpertId(baseId: string, existingIds: ReadonlySet<string>): string {
  let candidate = baseId;
  if (!RESERVED_EXPERT_IDS.has(candidate) && !existingIds.has(candidate)) {
    return candidate;
  }
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`;
    const trimmed = baseId.slice(0, Math.max(1, 63 - suffix.length));
    candidate = `${trimmed}${suffix}`;
    if (!RESERVED_EXPERT_IDS.has(candidate) && !existingIds.has(candidate)) {
      return candidate;
    }
  }
  return `expert-${Date.now().toString(36).slice(-8)}`;
}

export function isValidExpertId(id: string): boolean {
  return ENTITY_ID_RE.test(id) && !RESERVED_EXPERT_IDS.has(id) && !id.startsWith('_');
}
