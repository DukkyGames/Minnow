import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { SETTINGS_SECTIONS } = await import(
  '../../src/ui/settings-page-types.ts'
);
const { buildSettingsSearchIndex } = await import(
  '../../src/ui/settings-search-index.ts'
);

describe('settings-search-index', () => {
  test('section entries derive from SETTINGS_SECTIONS inventory', () => {
    const index = buildSettingsSearchIndex();
    const sectionEntries = index.filter((e) => e.kind === 'section');
    assert.equal(sectionEntries.length, SETTINGS_SECTIONS.length);
    for (const sectionId of SETTINGS_SECTIONS) {
      assert.ok(
        sectionEntries.some(
          (e) => e.sectionId === sectionId && e.id === `section:${sectionId}`,
        ),
        `missing section entry for ${sectionId}`,
      );
    }
  });

  test('orchestration alias maps to features section', () => {
    const index = buildSettingsSearchIndex();
    const features = index.find((e) => e.id === 'section:features');
    assert.ok(features);
    assert.ok(features.keywords?.includes('orchestration'));
  });

  test('servers section includes searxng and managed server keywords', () => {
    const index = buildSettingsSearchIndex();
    const servers = index.find((e) => e.id === 'section:servers');
    assert.ok(servers);
    assert.equal(servers.sectionId, 'servers');
    assert.ok(servers.keywords?.includes('searxng'));
    assert.ok(servers.keywords?.includes('managed server'));
  });

  test('includes built-in tool entries', () => {
    const index = buildSettingsSearchIndex();
    const webSearch = index.find((e) => e.id === 'tool:web_search');
    assert.ok(webSearch);
    assert.equal(webSearch.sectionId, 'search');
    assert.equal(webSearch.searchKey, 'tools.item.web_search');
  });

  test('includes tool category entries', () => {
    const index = buildSettingsSearchIndex();
    const webCat = index.find((e) => e.id === 'tool-category:web');
    assert.ok(webCat);
    assert.equal(webCat.searchKey, 'tools.category.web');
  });
});
