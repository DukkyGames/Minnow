/**
 * POSIX-ish argv tokenizer shared by the Models inspector and llama-server argv.
 * Must stay in lockstep with argv-tokenize.mjs.
 */

/** Split a shell-ish argument string into argv tokens (quotes + backslash escapes). */
export declare function tokenizeArgv(input: string): string[];

/** Quote a token so join + tokenize keeps values that contain whitespace. */
export declare function quoteArgvToken(token: string): string;

/**
 * Join argv tokens for display. Only tokens that contain whitespace are quoted,
 * so a naive whitespace split of `--chat-template "hello world"` still round-trips.
 */
export declare function joinArgv(tokens: readonly string[]): string;

/**
 * Tokenize extra_args whether it arrived as a string or a naive-split string[].
 */
export declare function normalizeExtraArgs(raw: unknown): string[];
