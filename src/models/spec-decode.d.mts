/** `--spec-type` values the bundled llama.cpp accepts. */
export type SpecDecodeType =
  | 'none'
  | 'draft-simple'
  | 'draft-eagle3'
  | 'draft-mtp'
  | 'ngram-simple'
  | 'ngram-map-k'
  | 'ngram-map-k4v'
  | 'ngram-mod'
  | 'ngram-cache';

export declare const SPEC_TYPES: ReadonlySet<string>;

/**
 * Modes that cannot start without a separate draft model. MTP is absent on purpose —
 * its heads ship inside the main GGUF.
 */
export declare const SPEC_TYPES_NEEDING_DRAFT_MODEL: ReadonlySet<string>;

export declare function specNeedsDraftModel(
  specType: unknown,
  draftModelPath: unknown,
): boolean;
