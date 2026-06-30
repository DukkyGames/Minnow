import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  ResearchProgressPanel,
  inferSourceType,
  progressPhaseToStep,
} from '../../src/research/progress-panel.ts';

describe('research progress panel', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.performance = window.performance;
    document.body.innerHTML = '<div id="progressMount"></div>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('progressPhaseToStep maps server phases to stepper indices', () => {
    assert.equal(progressPhaseToStep('planning'), 0);
    assert.equal(progressPhaseToStep('searching'), 1);
    assert.equal(progressPhaseToStep('reading'), 2);
    assert.equal(progressPhaseToStep('analyzing'), 3);
    assert.equal(progressPhaseToStep('writing'), 4);
  });

  test('inferSourceType detects paper hosts', () => {
    assert.equal(inferSourceType('https://arxiv.org/abs/1234'), 'paper');
  });

  test('inferSourceType labels local file paths as code', () => {
    assert.equal(inferSourceType('server/research/engine.js'), 'code');
    assert.equal(inferSourceType('file:///workspace/src/research/types.ts'), 'code');
  });

  test('apply progress renders stepper and feed rows', () => {
    const mount = document.getElementById('progressMount') as HTMLElement;
    const panel = new ResearchProgressPanel(mount);
    panel.reset();
    panel.apply({ phase: 'planning' });
    panel.apply({
      phase: 'reading',
      url: 'https://arxiv.org/abs/1234',
      title: 'Sample paper',
      totalSources: 3,
      round: 1,
    });
    assert.ok(mount.querySelector('.dr-prog'));
    assert.ok(mount.querySelector('.dr-stepper'));
    assert.ok(mount.querySelector('.dr-feed-row'));
    const feedLink = mount.querySelector('.dr-feed-title') as HTMLAnchorElement | null;
    assert.ok(feedLink);
    assert.equal(feedLink?.tagName, 'A');
    assert.equal(feedLink?.getAttribute('href'), 'https://arxiv.org/abs/1234');
    assert.equal(feedLink?.textContent, 'Sample paper');
    assert.equal(feedLink?.getAttribute('target'), '_blank');
    panel.complete('done');
    assert.ok(mount.querySelector('.dr-node.done'));
  });
});
