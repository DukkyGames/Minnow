import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const RESEARCH_IDS = [
  'btnResearch',
  'researchView',
  'researchQuery',
  'researchMaxRounds',
  'researchScope',
  'researchCategory',
  'btnResearchStart',
  'btnResearchCancel',
  'researchProgressMount',
  'researchResultMount',
  'researchTabRun',
  'researchTabLibrary',
  'researchLibraryMount',
];

describe('research page HTML', () => {
  for (const id of RESEARCH_IDS) {
    test(`#${id} exists in index.html`, () => {
      assert.match(html, new RegExp(`id="${id}"`));
    });
  }

  test('topbar button exists for research', () => {
    assert.match(html, /id="btnResearch"/);
    const tag = html.match(/<button[^>]*id="btnResearch"[^>]*>/)?.[0] ?? '';
    assert.doesNotMatch(tag, /\bon[a-z]+="/i);
  });

  test('research view is before appBody', () => {
    const research = html.indexOf('id="researchView"');
    const app = html.indexOf('id="appBody"');
    assert.ok(research > 0 && app > research);
  });

  test('page sub-header removed (OS menubar supplies navigation)', () => {
    assert.doesNotMatch(html, /class="research-page-header"/);
    assert.doesNotMatch(html, /id="btnResearchPageBack"/);
  });
});
