import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  initResearchPage,
  isResearchStartDisabledForTests,
  setResearchRunningForTests,
} from '../../src/research/panel.ts';

function buildResearchPageHtml(): string {
  return `
    <main id="researchView" class="research-page">
      <textarea id="researchQuery"></textarea>
      <select id="researchMaxRounds"><option value="auto">Auto</option></select>
      <select id="researchCategory"><option value="">Auto</option></select>
      <select id="researchSearchProvider"><option value=""></option></select>
      <select id="researchProviderOverride"><option value=""></option></select>
      <input id="researchModelOverride" />
      <button type="button" id="btnResearchStart">Start research</button>
      <button type="button" id="btnResearchCancel" hidden>Cancel</button>
      <div id="researchSynapseMount"></div>
      <div id="researchResultMount"></div>
      <button type="button" id="researchTabRun"></button>
      <button type="button" id="researchTabLibrary"></button>
      <div id="researchPanelRun"></div>
      <div id="researchPanelLibrary" class="hidden"></div>
      <div id="researchLibraryMount"></div>
      <button type="button" id="btnResearchSettingsLink"></button>
    </main>
  `;
}

describe('research panel', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    document.body.innerHTML = buildResearchPageHtml();
    initResearchPage();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('running state disables Start and shows Cancel', () => {
    setResearchRunningForTests(true);
    assert.equal(isResearchStartDisabledForTests(), true);
    const cancel = document.getElementById('btnResearchCancel') as HTMLButtonElement;
    assert.equal(cancel.hidden, false);
    const start = document.getElementById('btnResearchStart') as HTMLButtonElement;
    assert.equal(start.textContent, 'Running…');
    setResearchRunningForTests(false);
    assert.equal(isResearchStartDisabledForTests(), false);
    assert.equal(cancel.hidden, true);
  });
});
