/**
 * Speculative-decoding vocabulary, shared by the argv builder, the persistence
 * whitelist, the failure classifier, and the client.
 *
 * Its own module rather than a corner of `llama-args.js` because three of those four
 * callers have nothing to do with building argv — and because tests that mock the argv
 * builder should not lose the vocabulary along with it.
 */

/**
 * `--spec-type` values the bundled llama.cpp (b9628) accepts. Anything outside the set
 * is dropped rather than forwarded: an unknown mode makes llama-server exit before it
 * binds a port, so a typo would look like a crash.
 */
export const SPEC_TYPES = new Set([
  'none',
  'draft-simple',
  'draft-eagle3',
  'draft-mtp',
  'ngram-simple',
  'ngram-map-k',
  'ngram-map-k4v',
  'ngram-mod',
  'ngram-cache',
]);

/**
 * Modes that cannot start without `--spec-draft-model`.
 *
 * Verified on b9628: with the flag missing, llama-server registers the implementation
 * and then dies in the loader with **no error line at all** (SIGSEGV /
 * STATUS_ACCESS_VIOLATION). That is why both the inspector and the failure classifier
 * key off this set rather than off anything in the log.
 *
 * MTP is absent from the set on purpose — its heads ship inside the main GGUF.
 */
export const SPEC_TYPES_NEEDING_DRAFT_MODEL = new Set(['draft-simple', 'draft-eagle3']);

/**
 * True when this mode needs a second weights file the user has not supplied.
 * @param {unknown} specType
 * @param {unknown} draftModelPath
 */
export function specNeedsDraftModel(specType, draftModelPath) {
  if (!SPEC_TYPES_NEEDING_DRAFT_MODEL.has(String(specType))) return false;
  return !String(draftModelPath ?? '').trim();
}
