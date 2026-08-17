/**
 * POSIX-ish argv tokenizer shared by the Models inspector (client) and
 * `buildLlamaServerLaunch` (server). A naive `split(/\s+/)` turns
 * `--chat-template "hello world"` into three tokens and llama-server sees a
 * truncated template; quoting has to round-trip on both sides.
 *
 * This module must not spawn, touch the filesystem, or import `server/`.
 */

/**
 * Split a shell-ish argument string into argv tokens.
 * Double quotes, single quotes, and backslash escapes (outside single quotes).
 * Unclosed quotes consume the rest of the string as part of the current token.
 *
 * @param {string} input
 * @returns {string[]}
 */
export function tokenizeArgv(input) {
  if (typeof input !== 'string' || !input) return [];
  const out = [];
  let cur = '';
  let inToken = false;
  let quote = '';
  let escape = false;

  const flush = () => {
    if (!inToken) return;
    out.push(cur);
    cur = '';
    inToken = false;
  };

  for (const ch of input) {
    if (escape) {
      cur += ch;
      inToken = true;
      escape = false;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") quote = '';
      else cur += ch;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escape = true;
      inToken = true;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = '';
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      flush();
      continue;
    }
    cur += ch;
    inToken = true;
  }
  if (escape) cur += '\\';
  flush();
  return out;
}

/**
 * Quote a token so `join(' ') + tokenizeArgv` keeps values that contain
 * whitespace. Tokens without spaces are left unquoted (including naive-split
 * fragments like `"hello` that we recover by joining then retokenizing).
 *
 * @param {string} token
 * @returns {string}
 */
export function quoteArgvToken(token) {
  if (typeof token !== 'string') return '';
  if (token === '') return '""';
  if (!/[\s"'\\]/.test(token)) return token;
  return `"${token.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Join argv tokens for an inspector text box. Only tokens that contain
 * whitespace are quoted, so a naive whitespace split of `--chat-template "hello world"`
 * still round-trips after join + tokenize.
 *
 * @param {readonly string[]} tokens
 * @returns {string}
 */
export function joinArgv(tokens) {
  if (!Array.isArray(tokens)) return '';
  return tokens
    .filter((t) => typeof t === 'string' && t.length > 0)
    .map((t) => (/\s/.test(t) ? quoteArgvToken(t) : t))
    .join(' ');
}

/**
 * Normalize extra_args whether it arrived as a string or a string[].
 * Arrays are joined then retokenized so `"hello world"` smashed by `split(/\s+/)`
 * becomes one value again.
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeExtraArgs(raw) {
  if (typeof raw === 'string') return tokenizeArgv(raw);
  if (!Array.isArray(raw)) return [];
  const parts = raw.filter((t) => typeof t === 'string' && t.length > 0);
  if (parts.length === 0) return [];
  return tokenizeArgv(joinArgv(parts));
}
