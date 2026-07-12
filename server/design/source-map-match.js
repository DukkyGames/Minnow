/**
 * Element → source line matcher (MIN-369) — pure string matching, no I/O, used by
 * source-map-routes.js. Tries the cheapest/most-distinctive signal first (id attribute, then a
 * stable class combo scoped to the tag, then a normalized outerHTML slice); the first signal
 * that hits at least one line wins. A unique hit is 'exact', multiple hits (same signal) is
 * 'probable' (first match wins), zero hits across every signal returns null (caller falls back
 * to a plain 'guess').
 */

/**
 * @param {string} text
 * @returns {string}
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * @typedef {{ id?: string, tag?: string, classCombo?: string, htmlSnippet?: string }} SourceSignal
 * @typedef {{ line: number, confidence: 'exact' | 'probable', matchedBy: string }} SourceMatch
 */

/**
 * @param {string} fileText
 * @param {SourceSignal} signal
 * @returns {SourceMatch | null}
 */
export function findElementLineInSource(fileText, signal) {
  const lines = fileText.split(/\r?\n/);

  /** @type {Array<{ kind: string, test: (line: string) => boolean }>} */
  const attempts = [];

  const id = signal.id?.trim();
  if (id) {
    const idRe = new RegExp(`\\bid=["']${escapeRegExp(id)}["']`);
    attempts.push({ kind: 'id', test: (line) => idRe.test(line) });
  }

  const classCombo = signal.classCombo?.trim();
  if (classCombo) {
    const classes = classCombo.split(/\s+/).filter(Boolean);
    if (classes.length) {
      const classRes = classes.map((cls) => new RegExp(`\\b${escapeRegExp(cls)}\\b`));
      const tagRe = signal.tag?.trim() ? new RegExp(`<${escapeRegExp(signal.tag.trim())}\\b`, 'i') : null;
      attempts.push({
        kind: 'class',
        test: (line) => (tagRe ? tagRe.test(line) : true) && classRes.every((re) => re.test(line)),
      });
    }
  }

  const htmlSnippet = signal.htmlSnippet ? normalizeWhitespace(signal.htmlSnippet).slice(0, 60) : '';
  if (htmlSnippet.length >= 8) {
    attempts.push({
      kind: 'html',
      test: (line) => normalizeWhitespace(line).includes(htmlSnippet),
    });
  }

  for (const attempt of attempts) {
    const matchedLines = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (attempt.test(lines[i])) matchedLines.push(i + 1);
    }
    if (matchedLines.length === 1) {
      return { line: matchedLines[0], confidence: 'exact', matchedBy: attempt.kind };
    }
    if (matchedLines.length > 1) {
      return { line: matchedLines[0], confidence: 'probable', matchedBy: attempt.kind };
    }
  }

  return null;
}
