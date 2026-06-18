import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { renderResearchReportView } from '../../src/research/report-view.ts';

describe('research report view', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    document.body.innerHTML = '<div id="reportMount"></div>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('hides Save to Library when report is already persisted', () => {
    const mount = document.getElementById('reportMount') as HTMLElement;
    renderResearchReportView(
      mount,
      {
        title: 'Widget market',
        tldr: 'Summary',
        findings: [],
        sources: [],
        followups: [],
      },
      '1:00 · 3 scanned · 3 read · 1 rounds',
      {
        onExport: () => {},
        onRunAgain: () => {},
        onDiscuss: () => {},
        onRefine: () => {},
        onFollowUp: () => {},
        onViewLibrary: () => {},
      },
      { savedToLibrary: true },
    );

    assert.equal(mount.querySelector('#btnResearchSaved'), null);
    assert.ok(mount.querySelector('#btnResearchDiscuss'));
    assert.ok(mount.querySelector('#btnResearchRefine'));
  });

  test('shows Save to Library for unsaved drafts', () => {
    const mount = document.getElementById('reportMount') as HTMLElement;
    renderResearchReportView(
      mount,
      {
        title: 'Widget market',
        tldr: 'Summary',
        findings: [],
        sources: [],
        followups: [],
      },
      '1:00 · 3 scanned · 3 read · 1 rounds',
      {
        onExport: () => {},
        onRunAgain: () => {},
        onDiscuss: () => {},
        onRefine: () => {},
        onFollowUp: () => {},
        onViewLibrary: () => {},
      },
      { savedToLibrary: false },
    );

    assert.ok(mount.querySelector('#btnResearchSaved'));
  });
});
