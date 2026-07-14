/**
 * Split a shell-style argument string into tokens, respecting single/double quotes.
 * Used for llama-server extra_args entered in the Serve dialog.
 * @param {string} input
 * @returns {string[]}
 */
export function splitShellWords(input) {
  if (!input || !input.trim()) return [];

  /** @type {string[]} */
  const tokens = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && (inSingle || inDouble)) {
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}
