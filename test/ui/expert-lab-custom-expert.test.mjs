import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

function setupExpertLabDom() {
  const window = new Window();
  globalThis.document = window.document;
  document.body.innerHTML = `<main id="expertLabView" class="expert-lab-page" data-step="pick">
    <section class="expert-lab-step expert-lab-step--pick"></section>
    <section class="expert-lab-step expert-lab-step--create"></section>
    <section class="expert-lab-step expert-lab-step--edit"></section>
  </main>`;
}

describe('expert lab custom expert steps', () => {
  test('data-step attribute supports create and edit', () => {
    setupExpertLabDom();
    const root = document.getElementById('expertLabView');
    assert.ok(root);
    root.dataset.step = 'create';
    assert.equal(root.dataset.step, 'create');
    root.dataset.step = 'edit';
    assert.equal(root.dataset.step, 'edit');
  });
});
