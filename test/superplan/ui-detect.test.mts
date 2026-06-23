import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildTouchesUi } from '../../src/superplan/ui-detect.ts';

describe('superplan ui-detect', () => {
  test('returns false for backend-only specs', () => {
    assert.equal(
      buildTouchesUi('Add a REST API route and SQLite migration for user sessions.'),
      false,
    );
  });

  test('detects src/ui mentions', () => {
    assert.equal(
      buildTouchesUi('Update src/ui/sidebar.ts to add a new launcher chip.'),
      true,
    );
  });

  test('detects CSS and React in draft', () => {
    assert.equal(
      buildTouchesUi('API only', 'No frontend', 'Add React components and CSS tokens in src/styles.'),
      true,
    );
  });

  test('detects impeccable and UX signals', () => {
    assert.equal(buildTouchesUi('Run impeccable polish on the dashboard layout.'), true);
    assert.equal(buildTouchesUi('Improve UX copy on the onboarding form.'), true);
  });
});
