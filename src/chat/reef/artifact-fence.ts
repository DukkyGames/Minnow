/**
 * Parse artifact binding comments inside reef-widget fence bodies.
 */

const ARTIFACT_COMMENT_RE = /<!--\s*artifact:\s*([a-z0-9-]{1,64})\s*-->/i;

/** Extract durable artifact id from `<!-- artifact: slug -->` in fence HTML. */
export function parseReefArtifactIdFromFence(raw: string): string | undefined {
  const match = raw.match(ARTIFACT_COMMENT_RE);
  const id = match?.[1]?.trim().toLowerCase();
  if (!id) return undefined;
  if (!/^[a-z0-9-]{1,64}$/.test(id)) return undefined;
  return id;
}
