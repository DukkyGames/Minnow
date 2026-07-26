import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

describe('diagnostics prefs', () => {
  let prefs: typeof import('../../src/diagnostics/prefs.ts');

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window?: Window;
      localStorage?: Storage;
    };
    g.window = win;
    g.localStorage = win.localStorage;
    prefs = await import('../../src/diagnostics/prefs.ts');
    prefs.resetDiagnosticsPrefsForTests();
    win.localStorage.clear();
  });

  afterEach(() => {
    prefs.resetDiagnosticsPrefsForTests();
  });

  test('fileErrorsToIssues defaults to false', () => {
    assert.equal(prefs.loadDiagnosticsPrefs().fileErrorsToIssues, false);
    assert.equal(prefs.isFileErrorsToIssuesEnabled(), false);
  });

  test('saveDiagnosticsPref persists fileErrorsToIssues', () => {
    prefs.saveDiagnosticsPref('fileErrorsToIssues', true);
    assert.equal(
      localStorage.getItem(prefs.DIAGNOSTICS_PREFS_KEYS.fileErrorsToIssues),
      '1',
    );
    assert.equal(prefs.isFileErrorsToIssuesEnabled(), true);

    prefs.resetDiagnosticsPrefsForTests();
    assert.equal(prefs.loadDiagnosticsPrefs().fileErrorsToIssues, true);

    prefs.saveDiagnosticsPref('fileErrorsToIssues', false);
    assert.equal(
      prefs.loadDiagnosticsPrefs().fileErrorsToIssues,
      prefs.DEFAULT_DIAGNOSTICS_PREFS.fileErrorsToIssues,
    );
  });
});
