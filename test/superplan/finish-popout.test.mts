import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { mountSuperPlanFinishPopout } from '../../src/superplan/finish-popout.ts';

describe('superplan finish popout', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    document.body.innerHTML = '<div id="finishMount"></div>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('renders hero, plan preview, and hand-off buttons', () => {
    const mount = document.getElementById('finishMount') as HTMLElement;
    let revised: string | undefined;
    let orchestrated = false;
    let built = false;
    let closed = false;

    mountSuperPlanFinishPopout(mount, {
      planMarkdown: '# Widget refresh\n\n## TL;DR\n\nPolish the settings panel.\n\n## Waves\n\n- W1 UI',
      planPath: 'documentation/plans/superplan-widget-refresh.md',
      onRevise: (notes) => {
        revised = notes;
      },
      onStartOrchestrator: () => {
        orchestrated = true;
      },
      onSendToBuild: () => {
        built = true;
      },
      onClose: () => {
        closed = true;
      },
    });

    assert.ok(mount.querySelector('.sp-finish'));
    assert.ok(mount.querySelector('.sp-finish__title'));
    assert.ok(mount.querySelector('.sp-finish__plan .dr-rep-title'));
    assert.ok(mount.querySelector('[data-sp-orchestrate]'));
    assert.ok(mount.querySelector('[data-sp-build]'));
    assert.ok(mount.querySelector('[data-sp-revise]'));

    (mount.querySelector('[data-sp-orchestrate]') as HTMLButtonElement).click();
    (mount.querySelector('[data-sp-build]') as HTMLButtonElement).click();
    assert.equal(orchestrated, true);
    assert.equal(built, true);

    (mount.querySelector('[data-sp-revise]') as HTMLButtonElement).click();
    const notes = mount.querySelector('#sp-finish-revise-notes') as HTMLTextAreaElement;
    notes.value = 'Tighten scope';
    (mount.querySelector('[data-sp-submit-revise]') as HTMLButtonElement).click();
    assert.equal(revised, 'Tighten scope');

    (mount.querySelector('[data-sp-close]') as HTMLButtonElement).click();
    assert.equal(closed, true);
  });
});
