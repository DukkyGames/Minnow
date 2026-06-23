import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { SuperPlanProgressPanel } from '../../src/superplan/progress-panel.ts';

describe('SuperPlanProgressPanel', () => {
  let mount: HTMLDivElement;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    mount.remove();
  });

  test('reset renders stepper and applies progress events', () => {
    const panel = new SuperPlanProgressPanel(mount);
    panel.reset();
    assert.ok(mount.querySelector('.sp-prog'));
    assert.ok(mount.querySelector('.sp-stepper'));

    panel.apply({ stage: 'research', message: 'Scanning codebase' });
    assert.match(mount.textContent ?? '', /Scanning codebase/i);
    assert.ok(mount.querySelector('.sp-feed-row'));

    panel.destroy();
    assert.equal(mount.childElementCount, 0);
  });
});
