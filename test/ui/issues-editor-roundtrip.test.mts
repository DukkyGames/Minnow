/**
 * Editor round-trip — §13's blocking gate, exercised through the real editor.
 *
 * The scenario is the one that matters: an agent writes a description full of
 * markdown the editor cannot represent, the user opens it and edits one
 * paragraph in the middle, and everything they did not touch must come back
 * byte-identical.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const windows: Window[] = [];

async function mountEditor(value: string): Promise<{
  handle: Awaited<ReturnType<typeof importEditor>>['createIssueEditor'] extends (
    host: HTMLElement,
    options: infer O,
  ) => infer R
    ? R
    : never;
  host: HTMLElement;
  body: HTMLElement;
  changes: string[];
}> {
  const window = new Window({ url: 'http://localhost/' });
  windows.push(window);
  const globalAny = globalThis as Record<string, unknown>;
  globalAny.window = window;
  globalAny.document = window.document;
  globalAny.Node = window.Node;
  globalAny.NodeFilter = window.NodeFilter;
  globalAny.HTMLElement = window.HTMLElement;
  globalAny.Element = window.Element;

  const { createIssueEditor } = await importEditor();
  const host = window.document.createElement('div') as unknown as HTMLElement;
  window.document.body.appendChild(host as unknown as never);

  const changes: string[] = [];
  const handle = createIssueEditor(host, {
    value,
    onChange: (markdown: string) => changes.push(markdown),
  });
  const body = host.querySelector('.mn-editor__body') as HTMLElement;
  return { handle, host, body, changes } as never;
}

function importEditor(): Promise<typeof import('../../src/ui/issue-editor')> {
  return import('../../src/ui/issue-editor');
}

afterEach(() => {
  for (const window of windows.splice(0)) window.close();
});

/** A description shaped like something an agent would actually write. */
const AGENT_DOC = [
  '---',
  'generated-by: builder',
  '---',
  '',
  '## Findings',
  '',
  'The parser drops the second frame.',
  '',
  '<details>',
  '<summary>Full log</summary>',
  '',
  '    raw indented output',
  '</details>',
  '',
  '- [ ] reproduce',
  '- [x] locate',
  '',
  '```ts',
  'const x: number = 1;',
  '```',
  '',
  'See the note[^1] for context.',
  '',
  '[^1]: Filed against the old parser.',
  '',
  '[docs]: https://example.com "Reference"',
].join('\n');

describe('issue editor round-trip', () => {
  test('an untouched document serializes back byte-identically', async () => {
    const { handle } = await mountEditor(AGENT_DOC);
    assert.equal(handle.getValue(), AGENT_DOC);
  });

  test('markdown outside the subset renders read-only, never as an input', async () => {
    const { body } = await mountEditor(AGENT_DOC);
    const raw = Array.from(body.querySelectorAll('.mn-editor__raw'));
    const reasons = raw.map((el) => el.querySelector('.mn-editor__raw-label')?.textContent);

    assert.ok(reasons.includes('front matter'));
    assert.ok(reasons.includes('HTML'));
    assert.ok(reasons.includes('footnote'));
    assert.ok(reasons.includes('link definition'));
    for (const el of raw) {
      assert.equal(el.getAttribute('contenteditable'), 'false');
    }
  });

  test('editing one paragraph leaves every other byte alone', async () => {
    const { handle, body } = await mountEditor(AGENT_DOC);

    const para = Array.from(body.querySelectorAll('.mn-editor__para')).find((el) =>
      el.textContent?.includes('drops the second frame'),
    );
    assert.ok(para, 'expected the paragraph to be its own editable block');

    // Simulate a typed edit: the editor reads the DOM back for dirty blocks.
    para.textContent = 'The parser drops the third frame.';
    body.dispatchEvent(new (windows[0] as unknown as Window).Event('input', { bubbles: true }));

    // `input` alone only marks dirty; the value is read on demand.
    const out = handle.getValue();
    assert.equal(out, AGENT_DOC.replace('the second frame', 'the third frame'));
    assert.ok(out.includes('generated-by: builder'));
    assert.ok(out.includes('<summary>Full log</summary>'));
    assert.ok(out.includes('    raw indented output'));
    assert.ok(out.includes('[^1]: Filed against the old parser.'));
    assert.ok(out.includes('[docs]: https://example.com "Reference"'));
  });

  test('checklists render as real checkboxes reflecting their state', async () => {
    const { body } = await mountEditor(AGENT_DOC);
    const boxes = Array.from(
      body.querySelectorAll('.mn-editor__task-box'),
    ) as unknown as HTMLInputElement[];
    assert.equal(boxes.length, 2);
    assert.equal(boxes[0].checked, false);
    assert.equal(boxes[1].checked, true);
  });

  test('setValue replaces the document and keeps it lossless', async () => {
    const { handle } = await mountEditor('start');
    handle.setValue(AGENT_DOC);
    assert.equal(handle.getValue(), AGENT_DOC);
  });

  test('an empty description mounts without inventing content', async () => {
    const { handle, body } = await mountEditor('');
    assert.equal(handle.getValue(), '');
    assert.ok(body.classList.contains('is-empty'));
  });
});
