/**
 * Unicode-aware PDF text layout: font registry, run splitting, measured wrapping.
 */

import fs from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';

const REPLACEMENT_CHAR = '\uFFFD';

/** Registry order: Latin → CJK → emoji. */
const FONT_DEFS = [
  { key: 'latin', file: 'NotoSans-Regular.ttf' },
  { key: 'cjk', file: 'NotoSansSC-Regular.ttf' },
  { key: 'emoji', file: 'NotoEmoji-Regular.ttf' },
];

/** @type {Map<string, Buffer> | null} */
let cachedBuffers = null;

/** @type {Map<string, ReturnType<typeof fontkit.create>> | null} */
let cachedFontkitFonts = null;

/**
 * Load bundled TTF buffers once per process.
 *
 * @returns {Promise<Map<string, Buffer>>}
 */
async function ensureBuffers() {
  if (cachedBuffers) return cachedBuffers;
  cachedBuffers = new Map();
  for (const def of FONT_DEFS) {
    const fontUrl = new URL(`./fonts/${def.file}`, import.meta.url);
    cachedBuffers.set(def.key, await fs.readFile(fontUrl));
  }
  return cachedBuffers;
}

/**
 * Build fontkit faces for glyph coverage checks.
 *
 * @param {Map<string, Buffer>} buffers
 */
function ensureFontkitFonts(buffers) {
  if (cachedFontkitFonts) return cachedFontkitFonts;
  cachedFontkitFonts = new Map();
  for (const def of FONT_DEFS) {
    cachedFontkitFonts.set(def.key, fontkit.create(buffers.get(def.key)));
  }
  return cachedFontkitFonts;
}

/**
 * Warm font caches (buffers + fontkit faces).
 */
export async function preloadPdfFonts() {
  const buffers = await ensureBuffers();
  ensureFontkitFonts(buffers);
}

/**
 * Register fontkit and embed subsetted Noto fonts on a PDF document.
 *
 * @param {import('pdf-lib').PDFDocument} doc
 * @returns {Promise<Record<string, import('pdf-lib').PDFFont>>}
 */
export async function embedLayoutFonts(doc) {
  doc.registerFontkit(fontkit);
  const buffers = await ensureBuffers();
  /** @type {Record<string, import('pdf-lib').PDFFont>} */
  const embedded = {};
  for (const def of FONT_DEFS) {
    embedded[def.key] = await doc.embedFont(buffers.get(def.key), { subset: true });
  }
  return embedded;
}

/**
 * Pick the first registry font that has a glyph for the code point.
 *
 * @param {number} codePoint
 * @returns {string | null}
 */
function fontKeyForCodePoint(codePoint) {
  const faces = cachedFontkitFonts;
  if (!faces) {
    throw new Error('Fonts not loaded; call preloadPdfFonts() first');
  }
  for (const def of FONT_DEFS) {
    if (faces.get(def.key).hasGlyphForCodePoint(codePoint)) {
      return def.key;
    }
  }
  return null;
}

/**
 * Group text into maximal runs that share one embedded font key.
 *
 * @param {string} text
 * @returns {{ runs: { text: string, fontKey: string }[], replaced: string[] }}
 */
export function splitRuns(text) {
  if (!cachedFontkitFonts) {
    throw new Error('Fonts not loaded; call preloadPdfFonts() first');
  }

  /** @type {{ text: string, fontKey: string }[]} */
  const runs = [];
  /** @type {string[]} */
  const replaced = [];

  let currentKey = null;
  let currentText = '';

  const flush = () => {
    if (!currentText) return;
    runs.push({ text: currentText, fontKey: currentKey ?? 'latin' });
    currentText = '';
    currentKey = null;
  };

  for (const originalChar of text) {
    const codePoint = originalChar.codePointAt(0) ?? 0;
    let fontKey = fontKeyForCodePoint(codePoint);
    let char = originalChar;

    if (!fontKey) {
      replaced.push(originalChar);
      fontKey = fontKeyForCodePoint(REPLACEMENT_CHAR.codePointAt(0) ?? 0xfffd) ?? 'latin';
      char = REPLACEMENT_CHAR;
    }

    if (fontKey === currentKey) {
      currentText += char;
    } else {
      flush();
      currentKey = fontKey;
      currentText = char;
    }
  }
  flush();

  return { runs, replaced };
}

/**
 * @param {{ char: string, fontKey: string }[]} units
 * @param {Record<string, import('pdf-lib').PDFFont>} fonts
 * @returns {{ text: string, font: import('pdf-lib').PDFFont }[]}
 */
function unitsToRuns(units, fonts) {
  /** @type {{ text: string, font: import('pdf-lib').PDFFont }[]} */
  const runs = [];
  for (const unit of units) {
    const font = fonts[unit.fontKey];
    const last = runs[runs.length - 1];
    if (last && last.font === font) {
      last.text += unit.char;
    } else {
      runs.push({ text: unit.char, font });
    }
  }
  return runs;
}

/**
 * @param {string} text
 * @param {Record<string, import('pdf-lib').PDFFont>} fonts
 * @param {number} fontSize
 * @returns {number}
 */
function measureText(text, fonts, fontSize) {
  const { runs } = splitRuns(text);
  let width = 0;
  for (const run of runs) {
    width += fonts[run.fontKey].widthOfTextAtSize(run.text, fontSize);
  }
  return width;
}

/**
 * Expand split runs into per-code-point units for wrapping.
 *
 * @param {string} text
 * @returns {{ char: string, fontKey: string }[]}
 */
function textToUnits(text) {
  const { runs } = splitRuns(text);
  /** @type {{ char: string, fontKey: string }[]} */
  const units = [];
  for (const run of runs) {
    for (const char of run.text) {
      units.push({ char, fontKey: run.fontKey });
    }
  }
  return units;
}

/**
 * @param {{ char: string, fontKey: string }[]} units
 * @param {Record<string, import('pdf-lib').PDFFont>} fonts
 * @param {number} fontSize
 * @returns {number}
 */
function measureUnits(units, fonts, fontSize) {
  let width = 0;
  for (const unit of units) {
    width += fonts[unit.fontKey].widthOfTextAtSize(unit.char, fontSize);
  }
  return width;
}

/**
 * Wrap a single line to visual rows using measured widths.
 *
 * @param {string} text
 * @param {Record<string, import('pdf-lib').PDFFont>} fonts
 * @param {number} fontSize
 * @param {number} maxWidth
 * @returns {{ runs: { text: string, font: import('pdf-lib').PDFFont }[] }[]}
 */
export function wrapVisualLines(text, fonts, fontSize, maxWidth) {
  if (!text) {
    return [{ runs: [{ text: '', font: fonts.latin }] }];
  }

  const tokens = text.split(/(\s+)/);
  /** @type {{ runs: { text: string, font: import('pdf-lib').PDFFont }[] }[]} */
  const lines = [];
  /** @type {{ char: string, fontKey: string }[]} */
  let lineUnits = [];
  let lineWidth = 0;

  const flushLine = () => {
    if (lineUnits.length === 0) return;
    lines.push({ runs: unitsToRuns(lineUnits, fonts) });
    lineUnits = [];
    lineWidth = 0;
  };

  const appendUnits = (units) => {
    for (const unit of units) {
      const charWidth = fonts[unit.fontKey].widthOfTextAtSize(unit.char, fontSize);
      if (lineWidth + charWidth > maxWidth && lineUnits.length > 0) {
        flushLine();
      }
      lineUnits.push(unit);
      lineWidth += charWidth;
    }
  };

  for (const token of tokens) {
    if (!token) continue;

    if (/^\s+$/.test(token)) {
      if (lineUnits.length === 0) continue;
      const tokenWidth = measureText(token, fonts, fontSize);
      if (lineWidth + tokenWidth > maxWidth) {
        flushLine();
        continue;
      }
      appendUnits(textToUnits(token));
      continue;
    }

    const tokenUnits = textToUnits(token);
    const tokenWidth = measureUnits(tokenUnits, fonts, fontSize);

    if (tokenWidth <= maxWidth) {
      if (lineWidth + tokenWidth > maxWidth && lineUnits.length > 0) {
        flushLine();
      }
      appendUnits(tokenUnits);
      continue;
    }

    if (lineUnits.length > 0) {
      flushLine();
    }

    for (const unit of tokenUnits) {
      const charWidth = fonts[unit.fontKey].widthOfTextAtSize(unit.char, fontSize);
      if (lineWidth + charWidth > maxWidth && lineUnits.length > 0) {
        flushLine();
      }
      lineUnits.push(unit);
      lineWidth += charWidth;
    }
  }

  flushLine();
  return lines.length > 0 ? lines : [{ runs: [{ text: '', font: fonts.latin }] }];
}

/**
 * Lay out body paragraphs with pagination metadata.
 *
 * @param {string} body
 * @param {{
 *   fonts: Record<string, import('pdf-lib').PDFFont>,
 *   fontSize: number,
 *   lineHeight: number,
 *   margin: number,
 *   pageWidth: number,
 *   pageHeight: number,
 *   startY: number,
 * }} options
 * @returns {{ pages: { lines: { runs: { text: string, font: import('pdf-lib').PDFFont }[], y: number }[] }[], replaced: string[] }}
 */
export function layoutBodyText(body, options) {
  const { fonts, fontSize, lineHeight, margin, pageWidth, pageHeight, startY } = options;
  const maxWidth = pageWidth - margin * 2;
  /** @type {string[]} */
  const replaced = [];

  /** @type {{ lines: { runs: { text: string, font: import('pdf-lib').PDFFont }[], y: number }[] }[]} */
  const pages = [{ lines: [] }];
  let y = startY;

  const newPage = () => {
    pages.push({ lines: [] });
    y = pageHeight - margin;
  };

  const paragraphs = body.split(/\n\n+/);
  for (const paragraph of paragraphs) {
    const normalized = paragraph.replace(/\r\n/g, '\n').trim();
    if (!normalized) continue;

    for (const rawLine of normalized.split('\n')) {
      const { runs, replaced: lineReplaced } = splitRuns(rawLine);
      replaced.push(...lineReplaced);
      const lineText = runs.map((run) => run.text).join('');
      const visualLines = wrapVisualLines(lineText, fonts, fontSize, maxWidth);

      for (const visualLine of visualLines) {
        if (y < margin + lineHeight) {
          newPage();
        }
        pages[pages.length - 1].lines.push({ runs: visualLine.runs, y });
        y -= lineHeight;
      }
    }
    y -= lineHeight * 0.4;
  }

  return { pages, replaced };
}

/**
 * Draw one visual line of runs at the given baseline.
 *
 * @param {import('pdf-lib').PDFPage} page
 * @param {{ runs: { text: string, font: import('pdf-lib').PDFFont }[] }} line
 * @param {{ x: number, y: number, size: number }} position
 */
export function drawVisualLine(page, line, position) {
  let x = position.x;
  for (const run of line.runs) {
    if (!run.text) continue;
    page.drawText(run.text, {
      x,
      y: position.y,
      size: position.size,
      font: run.font,
    });
    x += run.font.widthOfTextAtSize(run.text, position.size);
  }
}

/**
 * @param {string[]} replaced
 * @returns {string}
 */
export function formatReplacedCharacters(replaced) {
  if (replaced.length === 0) return '';
  const unique = [...new Set(replaced)];
  const preview = unique.slice(0, 5).join(' ');
  const ellipsis = unique.length > 5 ? '…' : '';
  return ` (${replaced.length} characters replaced: ${preview}${ellipsis})`;
}
