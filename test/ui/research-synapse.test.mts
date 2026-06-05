import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  PHASE_LABEL,
  ResearchSynapse,
  phaseLabelCountForTests,
} from '../../src/research/synapse.ts';

describe('research synapse', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    document.body.innerHTML = '<div id="synapseMount"></div>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('PHASE_LABEL covers engine phases', () => {
    assert.ok(phaseLabelCountForTests() >= 7);
    assert.equal(PHASE_LABEL.planning, 'Planning research');
    assert.equal(PHASE_LABEL.searching, 'Searching the web');
  });

  test('applyProgress updates phase label and stats', () => {
    const mount = document.getElementById('synapseMount') as HTMLElement;
    const syn = new ResearchSynapse(mount);
    syn.reset();
    syn.applyProgress({
      phase: 'searching',
      round: 2,
      queries: 3,
      queryPreview: 'best widgets 2024',
      totalSources: 5,
    });
    const phase = mount.querySelector('[data-synapse-phase]');
    assert.equal(phase?.textContent, PHASE_LABEL.searching);
    const stats = mount.querySelector('[data-synapse-stats]');
    assert.match(stats?.textContent ?? '', /Round 2/);
    assert.match(stats?.textContent ?? '', /Sources 5/);
    syn.destroy();
  });

  test('complete marks terminal state', () => {
    const mount = document.getElementById('synapseMount') as HTMLElement;
    const syn = new ResearchSynapse(mount);
    syn.reset();
    syn.complete('done');
    assert.equal(mount.querySelector('[data-synapse-phase]')?.textContent, 'Complete');
    syn.destroy();
  });
});
