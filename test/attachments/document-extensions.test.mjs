/**
 * Shared office extension list (MIN-32).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isOfficeExtension,
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
});
