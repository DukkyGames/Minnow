import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { applySettingsPageFilter, clearSettingsPageFilter } = await import(
  '../../src/ui/settings-filter.ts'
);

function setupSettingsFilterDom() {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.CSS = window.CSS;

  document.body.innerHTML = `
    <button type="button" data-settings-nav-area="general" aria-current="page"></button>
    <main id="settingsView" class="settings-page is-open">
      <div class="settings-page-body">
        <div class="settings-content">
          <div class="settings-category is-active" data-category="general">
            <section
              id="settingsSection-general"
              class="settings-section settings-area settings-area--title-suppressed is-active"
              data-area="general"
            >
              <h2>General</h2>
              <div class="settings-section-body">
                <div data-settings-search-key="general.desktop">Desktop</div>
              </div>
            </section>
            <section
              id="settingsSection-notifications"
              class="settings-section settings-area settings-area--title-suppressed"
              data-area="notifications"
            >
              <h2>Notifications</h2>
              <div class="settings-section-body">
                <div data-settings-search-key="notifications.enabled">Alerts</div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  `;
}

describe('settings-filter', () => {
  afterEach(() => {
    clearSettingsPageFilter();
  });

  test('clearSettingsPageFilter removes is-filtering and is-filter-dim state', () => {
    setupSettingsFilterDom();
    applySettingsPageFilter('notification');
    const panel = document.querySelector('.settings-category[data-category="general"]');
    assert.ok(panel?.classList.contains('is-filtering'));
    assert.ok(
      panel?.querySelector('[data-area="general"]')?.classList.contains('is-filter-dim'),
    );

    clearSettingsPageFilter();

    assert.equal(panel?.classList.contains('is-filtering'), false);
    assert.equal(
      panel?.querySelector('[data-area="general"]')?.classList.contains('is-filter-dim'),
      false,
    );
    assert.equal(
      panel?.querySelector('[data-area="general"]')?.classList.contains('is-active'),
      true,
    );
  });
});
