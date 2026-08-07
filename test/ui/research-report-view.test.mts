import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { renderResearchReportView } from '../../src/research/report-view.ts';
import type { ParsedBrief } from '../../src/research/parse-brief.ts';

function brief(overrides: Partial<ParsedBrief> = {}): ParsedBrief {
  return {
    title: 'Widget market',
    tldr: 'Widgets are consolidating around two vendors.',
    findings: [],
    sources: [],
    followups: [],
    ...overrides,
  };
}

const SOURCES = [
  {
    url: 'https://example.com/a',
    title: 'Widget consolidation report',
    host: 'example.com',
    type: 'blog',
    snippet: 'Two vendors now hold 71% of the market.',
  },
  {
    url: 'https://arxiv.org/abs/1',
    title: 'On widgets',
    host: 'arxiv.org',
    type: 'paper',
    snippet: '',
  },
];

describe('research brief', () => {
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

  test('leads with the answer, then the findings', () => {
    const mount = document.getElementById('reportMount') as HTMLElement;
    renderResearchReportView(
      mount,
      brief({
        findings: [{ heading: 'Two vendors dominate', body: 'They hold most of it.', cites: [] }],
      }),
      { onFollowUp: () => {} },
    );

    const answer = mount.querySelector('.rs-answer');
    assert.match(answer?.textContent ?? '', /consolidating around two vendors/);
    assert.match(
      mount.querySelector('.rs-finding__claim')?.textContent ?? '',
      /Two vendors dominate/,
    );
  });

  test('no confidence label is shown, because the engine does not measure one', () => {
    const mount = document.getElementById('reportMount') as HTMLElement;
    renderResearchReportView(
      mount,
      brief({ sources: SOURCES }),
      { onFollowUp: () => {} },
    );
    assert.equal(mount.querySelector('.dr-conf'), null);
    assert.doesNotMatch(mount.textContent ?? '', /\bHigh\b|\bMed\b/);
  });

  test('a citation opens its source in place and highlights the reference', () => {
    const mount = document.getElementById('reportMount') as HTMLElement;
    renderResearchReportView(
      mount,
      brief({
        sources: SOURCES,
        findings: [{ heading: 'Claim', body: 'Body text.', cites: [1] }],
      }),
      { onFollowUp: () => {} },
    );

    const cite = mount.querySelector('.rs-cite') as HTMLButtonElement;
    assert.ok(cite);
    assert.equal((mount.querySelector('.rs-citebox') as HTMLElement).hidden, true);

    cite.click();
    const box = mount.querySelector('.rs-citebox') as HTMLElement;
    assert.equal(box.hidden, false);
    assert.match(box.textContent ?? '', /Widget consolidation report/);
    assert.match(box.textContent ?? '', /71% of the market/);
    assert.ok(mount.querySelector('.rs-ref[data-ref="1"].is-focus'));

    cite.click();
    assert.equal((mount.querySelector('.rs-citebox') as HTMLElement).hidden, true);
  });

  test('references are a numbered list at the foot', () => {
    const mount = document.getElementById('reportMount') as HTMLElement;
    renderResearchReportView(mount, brief({ sources: SOURCES }), { onFollowUp: () => {} });
    const refs = mount.querySelectorAll('.rs-ref');
    assert.equal(refs.length, 2);
    assert.equal(refs[0].querySelector('.rs-ref__n')?.textContent, '1');
    assert.equal(refs[1].querySelector('.rs-ref__host')?.textContent, 'arxiv.org');
  });

  test('a run with no sources says so instead of rendering an empty list', () => {
    const mount = document.getElementById('reportMount') as HTMLElement;
    renderResearchReportView(mount, brief(), { onFollowUp: () => {} });
    assert.match(mount.textContent ?? '', /recorded no sources/);
  });

  test('follow-ups hand their question back to the caller', () => {
    const mount = document.getElementById('reportMount') as HTMLElement;
    let asked = '';
    renderResearchReportView(
      mount,
      brief({ followups: ['What about pricing?'] }),
      { onFollowUp: (q) => { asked = q; } },
    );
    (mount.querySelector('.rs-follow__item') as HTMLButtonElement).click();
    assert.equal(asked, 'What about pricing?');
  });

  test('run-level actions are not duplicated in the brief body', () => {
    const mount = document.getElementById('reportMount') as HTMLElement;
    renderResearchReportView(mount, brief(), { onFollowUp: () => {} });
    assert.equal(mount.querySelector('#btnResearchExport'), null);
    assert.equal(mount.querySelector('#btnResearchDiscuss'), null);
    assert.equal(mount.querySelector('#btnResearchSaved'), null);
  });
});
