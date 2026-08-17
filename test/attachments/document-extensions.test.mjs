/**
 * Shared office extension list (MIN-32).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getDocumentPreviewKind,
  isOfficeExtension,
  isPdfFilePath,
  isDocumentFilePath,
  isSpreadsheetFilePath,
  isWordFilePath,
  OFFICE_EXTENSIONS,
} from '../../src/attachments/document-extensions.mjs';

describe('document-extensions', () => {
  it('includes Excel and common office types', () => {
    assert.ok(OFFICE_EXTENSIONS.has('xlsx'));
    assert.ok(OFFICE_EXTENSIONS.has('xls'));
    assert.ok(OFFICE_EXTENSIONS.has('docx'));
    assert.ok(OFFICE_EXTENSIONS.has('pptx'));
    assert.ok(OFFICE_EXTENSIONS.has('odt'));
  });

  it('detects office paths by extension', () => {
    assert.equal(isOfficeExtension('reports/Q1.xlsx'), true);
    assert.equal(isOfficeExtension('readme.md'), false);
  });

  it('classifies document preview kinds', () => {
    assert.equal(isPdfFilePath('report.pdf'), true);
    assert.equal(isDocumentFilePath('budget.xlsx'), true);
    assert.equal(isDocumentFilePath('notes.pdf'), true);
    assert.equal(isDocumentFilePath('readme.md'), false);
    assert.equal(isDocumentFilePath('data.csv'), false);
    assert.equal(isSpreadsheetFilePath('budget.xlsx'), true);
    assert.equal(isSpreadsheetFilePath('data.csv'), false);
    assert.equal(isWordFilePath('memo.docx'), true);
    assert.equal(getDocumentPreviewKind('report.pdf'), 'pdf');
    assert.equal(getDocumentPreviewKind('budget.xlsx'), 'spreadsheet');
    assert.equal(getDocumentPreviewKind('data.csv'), null);
    assert.equal(getDocumentPreviewKind('memo.docx'), 'word');
    assert.equal(getDocumentPreviewKind('notes.md'), null);
  });
});
