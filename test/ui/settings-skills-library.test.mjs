/**
 * Skills Library settings UI tests (MIN-477).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

describe('settings skills-library section', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test("refreshSettingsSection('skills-library') renders pack cards offline", async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;

    document.body.innerHTML = `
      <div id="settingsSkillsLibraryBody" class="settings-section-body"></div>
    `;

    const { setLocalServerAvailable } = await import('../../src/tools/config.ts');
    setLocalServerAvailable(false);

    const { refreshSettingsSection } = await import('../../src/ui/settings-sections.ts');
    await refreshSettingsSection('skills-library');

    const grid = document.querySelector('.settings-skills-library__pack-grid');
    assert.ok(grid, 'pack grid should render');
    const cards = grid.querySelectorAll('.settings-skills-library__pack-card');
    assert.equal(cards.length, 5);

    const labels = [...cards].map((card) => card.querySelector('.settings-skills-library__pack-label')?.textContent);
    assert.ok(labels.some((label) => /Matt Pocock/i.test(label ?? '')));
    assert.ok(labels.some((label) => /Browserbase/i.test(label ?? '')));
    assert.ok(!labels.some((label) => /Antigravity|AWS/i.test(label ?? '')));

    const githubInput = document.querySelector('.settings-skills-library__url-input');
    assert.ok(githubInput);
    const installBtn = document.querySelector('.settings-skills-library__github-form .settings-action-btn');
    assert.ok(installBtn);
    assert.equal(installBtn.disabled, true);
  });

  test('pack card opens detail with filter and install actions', async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;

    document.body.innerHTML = `
      <div id="settingsSkillsLibraryBody" class="settings-section-body"></div>
    `;

    const { setLocalServerAvailable } = await import('../../src/tools/config.ts');
    setLocalServerAvailable(false);

    const { refreshSettingsSection } = await import('../../src/ui/settings-sections.ts');
    await refreshSettingsSection('skills-library');

    const mattCard = [...document.querySelectorAll('.settings-skills-library__pack-card')].find(
      (card) => card.dataset.packId === 'matt-pocock',
    );
    assert.ok(mattCard);
    mattCard.dispatchEvent(new window.Event('click', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    const detail = document.querySelector('.settings-skills-library__detail');
    assert.ok(detail);
    assert.ok(!detail.classList.contains('hidden'));

    const filter = document.querySelector('.settings-skills-library__filter-input');
    assert.ok(filter);
    const installAll = document.querySelector('.settings-skills-library__detail-toolbar .settings-action-btn--primary');
    assert.ok(installAll);

    const skillRows = detail.querySelectorAll('.settings-skills-library__skill-row');
    assert.ok(skillRows.length > 0);
  });
});
