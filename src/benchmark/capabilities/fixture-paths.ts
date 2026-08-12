/**
 * Capability-matrix fixture paths and tokens (pure constants).
 * Split from `fixtures-workspace.ts` so prompt modules stay free of tool-sandbox imports.
 */

/** Root folder for all capability-matrix fixtures (relative to benchmark workspace). */
export const CAPABILITY_MATRIX_FIXTURE_DIR = 'matrix';

export const CAP_MATRIX_NOTES_PATH = `${CAPABILITY_MATRIX_FIXTURE_DIR}/notes.md`;
export const CAP_MATRIX_SAMPLE_PATH = `${CAPABILITY_MATRIX_FIXTURE_DIR}/sample.ts`;
export const CAP_MATRIX_HAYSTACK_PATH = `${CAPABILITY_MATRIX_FIXTURE_DIR}/haystack.txt`;
export const CAP_MATRIX_JSON_PATH = `${CAPABILITY_MATRIX_FIXTURE_DIR}/a/b/c.json`;
export const CAP_MATRIX_PDF_PATH = `${CAPABILITY_MATRIX_FIXTURE_DIR}/fixture.pdf`;
export const CAP_MATRIX_REPO_DIR = `${CAPABILITY_MATRIX_FIXTURE_DIR}/repo`;

/** Grep probe token — only present in seeded fixture files. */
export const CAP_MATRIX_GREP_TOKEN = 'cap-matrix-grep-token-42';

/** JSON value probes can ask the model to read back. */
export const CAP_MATRIX_JSON_KEY = 'bench-alpha-7';

/** Symbol name in sample.ts for code-intel probes. */
export const CAP_MATRIX_SAMPLE_FN = 'capMatrixSampleFn';

/** File carrying a real seeded bug so the Debug-mode probe has something to find. */
export const CAP_MATRIX_BUGGY_PATH = `${CAPABILITY_MATRIX_FIXTURE_DIR}/buggy.ts`;

/** Function in buggy.ts with an off-by-one that drops the first element. */
export const CAP_MATRIX_BUGGY_FN = 'capMatrixTotal';

/**
 * Long-context needle buried in `haystack.txt`.
 * Never put this string in a probe prompt — the model must retrieve it.
 */
export const CAP_MATRIX_HAYSTACK_NEEDLE = 'needle-marker-cap-matrix';

/** Label the model is told to look for, so the prompt can describe the needle without naming it. */
export const CAP_MATRIX_HAYSTACK_LABEL = 'MATRIX-NEEDLE';
