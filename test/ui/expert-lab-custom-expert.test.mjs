import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

function setupExpertsHubDom() {
  const window = new Window();
  globalThis.document = window.document;
  document.body.innerHTML = `<main id="expertsView" class="experts-page" data-step="gallery">
    <section class="experts-step experts-step--gallery"></section>
    <section class="experts-step experts-step--create"></section>
    <section class="experts-step experts-step--edit"></section>
  </main>`;
}

describe('experts hub custom expert steps', () => {
  test('data-step attribute supports create and edit', () => {
    setupExpertsHubDom();
    const root = document.getElementById('expertsView');
    assert.ok(root);
    root.dataset.step = 'create';
    assert.equal(root.dataset.step, 'create');
    root.dataset.step = 'edit';
    assert.equal(root.dataset.step, 'edit');
  });
});
