/**
 * Document preview HTML — XSS hardening (Phase 1).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderDocumentPreviewHtml } from '../../server/preview/document-html.js';

const EVIL_SHEET_NAME = '"><svg onload=alert(1)>';

/**
 * Build an xlsx buffer whose sheet name cannot be set via book_append_sheet.
 *
 * @returns {Promise<Buffer | null>}
 */
async function buildEvilSheetNameXlsxBuffer() {
  let XLSX;
  try {
    const mod = await import('xlsx');
    XLSX = mod.default ?? mod;
  } catch {
    return null;
  }

  const sheet = XLSX.utils.aoa_to_sheet([['safe', 'value']]);
  const book = {
    SheetNames: [EVIL_SHEET_NAME],
    Sheets: { [EVIL_SHEET_NAME]: sheet },
  };
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Build a docx buffer containing a javascript: hyperlink.
 *
 * @returns {Promise<Buffer | null>}
 */
async function buildJavascriptHyperlinkDocxBuffer() {
  let docx;
  try {
    docx = await import('docx');
  } catch {
    return null;
  }

  const { Document, ExternalHyperlink, Packer, Paragraph, TextRun } = docx;
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new ExternalHyperlink({
                children: [new TextRun({ text: 'Click me', style: 'Hyperlink' })],
                link: 'javascript:alert(1)',
              }),
            ],
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(document);
}

/**
 * @param {string} html
 * @returns {number}
 */
function countHtmlRootElements(html) {
  const matches = html.match(/<html\b/gi);
  return matches ? matches.length : 0;
}

describe('renderDocumentPreviewHtml security', () => {
  it('strips XSS from spreadsheet sheet names and nested SheetJS markup', async () => {
    const buffer = await buildEvilSheetNameXlsxBuffer();
    if (!buffer) {
      console.log('skip: xlsx optional dependency not installed');
      return;
    }

    const html = await renderDocumentPreviewHtml('evil.xlsx', buffer);

    assert.doesNotMatch(html, /<svg\b/i);
    assert.doesNotMatch(html, /<[^>]*onload\s*=/i);
    assert.match(html, /&quot;&gt;&lt;svg/i);
    assert.equal(countHtmlRootElements(html), 1);
  });

  it('strips javascript: hyperlinks from docx preview HTML', async () => {
    const buffer = await buildJavascriptHyperlinkDocxBuffer();
    if (!buffer) {
      console.log('skip: docx optional dependency not installed');
      return;
    }

    const html = await renderDocumentPreviewHtml('evil.docx', buffer);

    assert.doesNotMatch(html, /javascript:/i);
    assert.doesNotMatch(html, /\shref\s*=/i);
    assert.match(html, /Click me/);
    assert.equal(countHtmlRootElements(html), 1);
  });
});
