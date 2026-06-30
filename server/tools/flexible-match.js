/**
 * Tolerant text matching for file-edit tools (line endings, trailing whitespace).
 */

/**
 * Detect the dominant end-of-line sequence in file content.
 * @param {string} content
 * @returns {'\r\n' | '\n'}
 */
export function detectDominantEol(content) {
  const text = String(content ?? '');
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  return crlf >= lf ? '\r\n' : '\n';
}

/**
 * Convert LF-only newlines in a string to the target EOL style.
 * @param {string} text
 * @param {'\r\n' | '\n'} eol
 */
export function applyDominantEol(text, eol) {
  return String(text ?? '').replace(/\r\n|\n/g, eol);
}

/**
 * Split content into line records with byte offsets (preserves original EOL per line).
 * @param {string} content
 * @returns {Array<{ text: string; start: number; end: number; eol: string }>}
 */
function parseLinesWithOffsets(content) {
  const text = String(content ?? '');
  const lines = [];
  let lastIndex = 0;
  const re = /\r\n|\n|\r/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    lines.push({
      text: text.slice(lastIndex, match.index),
      start: lastIndex,
      end: match.index,
      eol: match[0],
    });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    lines.push({ text: text.slice(lastIndex), start: lastIndex, end: text.length, eol: '' });
  } else if (text.length === 0) {
    lines.push({ text: '', start: 0, end: 0, eol: '' });
  }
  return lines;
}

/**
 * Split a multi-line pattern into comparable line strings (EOL stripped).
 * @param {string} text
 */
function patternLines(text) {
  return String(text ?? '').split(/\r?\n/);
}

/**
 * Build a near-miss hint when whitespace matching fails.
 * @param {string} content
 * @param {string} search
 */
function buildNearMissHint(content, search) {
  const searchLines = patternLines(search).map((line) => line.trimEnd());
  if (searchLines.length === 0 || (searchLines.length === 1 && searchLines[0] === '')) {
    return 'No occurrences of search text';
  }

  const fileLines = parseLinesWithOffsets(content);
  const first = searchLines[0];
  for (let i = 0; i < fileLines.length; i += 1) {
    if (fileLines[i].text.trimEnd() === first) {
      return `No occurrences of search text — first search line was found at line ${i + 1} but surrounding lines differ in whitespace`;
    }
  }
  return 'No occurrences of search text';
}

/**
 * Replace all whitespace-tolerant line-window matches in content.
 * @param {string} content
 * @param {string} search
 * @param {string} replace
 * @returns {{ output: string; count: number } | null}
 */
function replaceWhitespaceTolerant(content, search, replace) {
  const searchLines = patternLines(search).map((line) => line.trimEnd());
  if (searchLines.length === 0) return null;

  const fileLines = parseLinesWithOffsets(content);
  const replaceLines = patternLines(replace);
  const windowSize = searchLines.length;

  /** @type {Array<{ start: number; end: number }>} */
  const matches = [];

  for (let i = 0; i <= fileLines.length - windowSize; i += 1) {
    let ok = true;
    for (let j = 0; j < windowSize; j += 1) {
      if (fileLines[i + j].text.trimEnd() !== searchLines[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const first = fileLines[i];
      const last = fileLines[i + windowSize - 1];
      const endPos = last.end + last.eol.length;
      matches.push({ start: first.start, end: endPos, endLine: i + windowSize - 1 });
      i += windowSize - 1;
    }
  }

  if (matches.length === 0) return null;

  const eol = detectDominantEol(content);
  let replacement = replaceLines.join(eol);
  let output = '';
  let cursor = 0;
  for (const m of matches) {
    output += content.slice(cursor, m.start);
    const lastLine = fileLines[m.endLine];
    const trailingEol = lastLine?.eol ?? '';
    let sliceReplacement = replacement;
    if (
      m.end < content.length &&
      trailingEol &&
      !sliceReplacement.endsWith('\n') &&
      !sliceReplacement.endsWith('\r\n')
    ) {
      sliceReplacement += trailingEol;
    }
    output += sliceReplacement;
    cursor = m.end;
  }
  output += content.slice(cursor);

  return { output, count: matches.length };
}

/**
 * Try exact, EOL-normalized, then whitespace-tolerant replacement.
 * @param {string} content
 * @param {string} search
 * @param {string} replace
 * @returns {{ output: string; count: number; mode: 'exact' | 'eol' | 'whitespace' | null; hint?: string }}
 */
export function flexibleReplaceAll(content, search, replace) {
  const file = String(content ?? '');
  const needle = String(search ?? '');
  const repl = String(replace ?? '');

  // 1. Exact match
  const exactParts = file.split(needle);
  const exactCount = needle.length > 0 ? exactParts.length - 1 : 0;
  if (exactCount > 0) {
    return { output: exactParts.join(repl), count: exactCount, mode: 'exact' };
  }

  // 2. EOL-normalized match
  const fileEol = detectDominantEol(file);
  const eolNeedle = applyDominantEol(needle, fileEol);
  const eolRepl = applyDominantEol(repl, fileEol);
  if (eolNeedle !== needle || eolRepl !== repl) {
    const eolParts = file.split(eolNeedle);
    const eolCount = eolNeedle.length > 0 ? eolParts.length - 1 : 0;
    if (eolCount > 0) {
      return { output: eolParts.join(eolRepl), count: eolCount, mode: 'eol' };
    }
  }

  // 3. Whitespace-tolerant line-window match
  const wsResult = replaceWhitespaceTolerant(file, needle, repl);
  if (wsResult) {
    return { output: wsResult.output, count: wsResult.count, mode: 'whitespace' };
  }

  return {
    output: file,
    count: 0,
    mode: null,
    hint: buildNearMissHint(file, needle),
  };
}

/**
 * Human-readable suffix describing the match mode used.
 * @param {'exact' | 'eol' | 'whitespace' | null} mode
 */
export function matchModeLabel(mode) {
  if (mode === 'eol') return 'line-ending tolerant match';
  if (mode === 'whitespace') return 'whitespace-insensitive match';
  return '';
}

/**
 * Find all start indices of a substring in content.
 * @param {string} content
 * @param {string} needle
 */
function findAllIndices(content, needle) {
  /** @type {number[]} */
  const indices = [];
  if (!needle) return indices;
  let pos = 0;
  while (pos < content.length) {
    const idx = content.indexOf(needle, pos);
    if (idx === -1) break;
    indices.push(idx);
    pos = idx + needle.length;
  }
  return indices;
}

/**
 * Resolve a unique anchor position, trying exact then EOL-normalized search.
 * @param {string} content
 * @param {string} anchor
 * @returns {{ index: number; length: number } | { error: string }}
 */
function resolveUniqueAnchor(content, anchor) {
  const text = String(content ?? '');
  const needle = String(anchor ?? '');
  if (!needle) {
    return { error: 'anchor text must not be empty' };
  }

  let indices = findAllIndices(text, needle);
  if (indices.length === 0) {
    const eolNeedle = applyDominantEol(needle, detectDominantEol(text));
    if (eolNeedle !== needle) {
      indices = findAllIndices(text, eolNeedle);
      if (indices.length === 1) {
        return { index: indices[0], length: eolNeedle.length };
      }
      if (indices.length > 1) {
        return { error: `anchor text appears ${indices.length} times; provide a more specific anchor` };
      }
    }
    return { error: 'anchor text not found in file' };
  }
  if (indices.length > 1) {
    return { error: `anchor text appears ${indices.length} times; provide a more specific anchor` };
  }
  return { index: indices[0], length: needle.length };
}

/**
 * Line index (0-based) at a character offset.
 * @param {string} content
 * @param {number} charIndex
 */
function lineIndexAtChar(content, charIndex) {
  return content.slice(0, charIndex).split(/\r?\n/).length - 1;
}

/**
 * Resolve insertion line index from an anchor string.
 * @param {string} content Current file contents.
 * @param {string} anchor Text to locate.
 * @param {'before' | 'after'} position Insert before or after the anchor line.
 * @returns {{ lineIndex: number } | { error: string }}
 */
export function resolveInsertLineFromAnchor(content, anchor, position) {
  const resolved = resolveUniqueAnchor(content, anchor);
  if ('error' in resolved) return resolved;

  const { index, length } = resolved;
  const anchorStartLine = lineIndexAtChar(content, index);
  const anchorEndLine = lineIndexAtChar(content, index + length);

  if (position === 'before') {
    return { lineIndex: anchorStartLine };
  }
  // Insert after the line containing the end of the anchor.
  return { lineIndex: anchorEndLine + 1 };
}

/**
 * Align write content with an existing file's dominant line endings.
 * New files pass empty `existingContent` and are left unchanged (typically LF from the agent).
 * @param {string} content Proposed file body from the agent.
 * @param {string} existingContent Current on-disk body ('' when creating a new file).
 * @returns {{ content: string; converted: boolean; eol: '\r\n' | '\n' | null }}
 */
export function coerceContentToFileEol(content, existingContent) {
  const next = String(content ?? '');
  const existing = String(existingContent ?? '');
  if (!existing) {
    return { content: next, converted: false, eol: null };
  }
  const eol = detectDominantEol(existing);
  const coerced = applyDominantEol(next, eol);
  const converted = coerced !== next;
  return { content: coerced, converted, eol };
}
