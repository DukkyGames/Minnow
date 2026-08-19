/**
 * Block model round-trip — the blocking gate for Phase 3.
 *
 * The rule under test is that parsing and reassembling a document is the
 * identity function, for *any* input, including markdown the editor cannot
 * represent. Everything else in the editor rests on that: a block the user
 * never touched is emitted from `source` verbatim, so if this holds, untouched
 * regions are byte-identical by construction rather than by care.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  isEditableBlock,
  parseMarkdownBlocks,
  parseTaskItems,
  roundTripsExactly,
  serializeMarkdownBlocks,
  taskProgress,
  toggleTaskItem,
} from '../../src/issues/markdown-blocks.ts';

/** Documents chosen to be hostile to a naive markdown round-trip. */
const ADVERSARIAL: Array<[string, string]> = [
  ['empty', ''],
  ['only whitespace', '\n\n   \n\n'],
  ['no trailing newline', 'One paragraph'],
  ['trailing newlines', 'One\n\n\n'],
  ['windows-ish blank runs', 'a\n\n\n\nb'],
  [
    'front matter',
    '---\ntitle: Thing\ntags: [a, b]\n---\n\nBody text\n',
  ],
  [
    'html block',
    'Before\n\n<details>\n<summary>Click</summary>\n\nHidden\n</details>\n\nAfter\n',
  ],
  ['footnotes', 'Text with a note[^1]\n\n[^1]: The note body\n'],
  ['link definitions', 'See [docs][d]\n\n[d]: https://example.com "Title"\n'],
  ['indented code', 'Intro\n\n    const x = 1;\n    boom();\n\nOutro\n'],
  [
    'unclosed fence',
    'Intro\n\n```ts\nconst x = 1;\nnever closed\n',
  ],
  [
    'fence containing fences',
    'Intro\n\n````md\n```ts\ninner\n```\n````\n\nOutro\n',
  ],
  [
    'tilde fence',
    '~~~python\nprint("hi")\n~~~\n',
  ],
  [
    'nested list',
    '- top\n  - nested\n    - deeper\n- back\n',
  ],
  [
    'table',
    '| a | b |\n|---|:-:|\n| 1 | 2 |\n\nAfter\n',
  ],
  [
    'setext heading',
    'Title\n=====\n\nBody\n',
  ],
  [
    'mixed everything',
    [
      '# Heading',
      '',
      'Paragraph with **bold** and `code`.',
      '',
      '- [ ] todo one',
      '- [x] done two',
      '',
      '> quote line',
      '> second line',
      '',
      '```bash',
      'npm test',
      '```',
      '',
      '---',
      '',
      '<div align="center">raw html</div>',
      '',
      'Trailing paragraph.',
    ].join('\n'),
  ],
  ['crlf-ish stray carriage returns', 'a\r\n\r\nb\r\n'],
  ['tabs and hard breaks', 'line one  \nline two\t\n\nnext\n'],
  ['lone divider', '---\n'],
  ['heading-like without space', '#nothashheading\n'],
  ['emoji and unicode', '# 🐟 Título\n\nÇalışma — “quotes” … \n'],
];

describe('parse/serialize is the identity function', () => {
  for (const [name, doc] of ADVERSARIAL) {
    test(name, () => {
      const out = serializeMarkdownBlocks(parseMarkdownBlocks(doc));
      assert.equal(out, doc, `round-trip changed the document for: ${name}`);
    });
  }

  test('roundTripsExactly agrees', () => {
    for (const [, doc] of ADVERSARIAL) {
      assert.equal(roundTripsExactly(doc), true);
    }
  });

  test('holds for a document assembled from every fixture at once', () => {
    const combined = ADVERSARIAL.map(([, doc]) => doc).join('\n\n');
    assert.equal(roundTripsExactly(combined), true);
  });
});

describe('editing one block leaves every other byte alone', () => {
  test('replacing a paragraph preserves raw neighbours exactly', () => {
    const doc = [
      '---',
      'title: keep me',
      '---',
      '',
      '<div>untouched html</div>',
      '',
      'Edit this paragraph.',
      '',
      '    indented code stays',
      '',
      '[ref]: https://example.com',
    ].join('\n');

    const blocks = parseMarkdownBlocks(doc);
    const target = blocks.find((b) => b.source === 'Edit this paragraph.');
    assert.ok(target, 'expected the paragraph to be its own block');

    const edited = blocks.map((b) =>
      b === target ? { ...b, source: 'Rewritten paragraph.' } : b,
    );
    const out = serializeMarkdownBlocks(edited);

    assert.equal(out, doc.replace('Edit this paragraph.', 'Rewritten paragraph.'));
    assert.ok(out.includes('title: keep me'));
    assert.ok(out.includes('<div>untouched html</div>'));
    assert.ok(out.includes('    indented code stays'));
    assert.ok(out.includes('[ref]: https://example.com'));
  });
});

describe('block classification', () => {
  test('unrepresentable constructs are raw and not editable', () => {
    const cases: Array<[string, string]> = [
      ['<p>html</p>', 'HTML'],
      ['[^1]: note', 'footnote'],
      ['[d]: https://x.test', 'link definition'],
      ['    indented', 'indented code'],
      ['- a\n  - b', 'nested list'],
      ['```\nunclosed', 'unclosed code fence'],
    ];
    for (const [doc, reason] of cases) {
      const block = parseMarkdownBlocks(doc)[0];
      assert.equal(block.kind, 'raw', `${doc} should be raw`);
      assert.equal(block.rawReason, reason);
      assert.equal(isEditableBlock(block), false);
    }
  });

  test('supported constructs are editable', () => {
    const cases: Array<[string, string]> = [
      ['# Title', 'heading'],
      ['Just text', 'paragraph'],
      ['- one\n- two', 'bullet-list'],
      ['1. one\n2. two', 'ordered-list'],
      ['- [ ] todo', 'task-list'],
      ['> quoted', 'quote'],
      ['```ts\nx\n```', 'code'],
      ['| a |\n|---|\n| 1 |', 'table'],
      ['---', 'divider'],
    ];
    for (const [doc, kind] of cases) {
      const block = parseMarkdownBlocks(doc)[0];
      assert.equal(block.kind, kind, `${doc} should be ${kind}`);
      assert.equal(isEditableBlock(block), true);
    }
  });

  test('a fence keeps its language', () => {
    assert.equal(parseMarkdownBlocks('```ts\nx\n```')[0].language, 'ts');
    assert.equal(parseMarkdownBlocks('```\nx\n```')[0].language, undefined);
  });

  test('a heading keeps its level', () => {
    assert.equal(parseMarkdownBlocks('### Deep')[0].level, 3);
  });

  test('a heading after a paragraph starts its own block', () => {
    const blocks = parseMarkdownBlocks('para\n# heading');
    assert.deepEqual(
      blocks.map((b) => b.kind),
      ['paragraph', 'heading'],
    );
  });
});

describe('task lists are state', () => {
  const doc = '- [ ] first\n- [x] second\n- [ ] third';

  test('parses each checkbox with its line index', () => {
    const items = parseTaskItems(parseMarkdownBlocks(doc)[0]);
    assert.deepEqual(
      items.map((i) => [i.line, i.checked, i.text]),
      [
        [0, false, 'first'],
        [1, true, 'second'],
        [2, false, 'third'],
      ],
    );
  });

  test('toggling rewrites exactly one character', () => {
    const block = parseMarkdownBlocks(doc)[0];
    const toggled = toggleTaskItem(block, 0);
    assert.equal(toggled.source, '- [x] first\n- [x] second\n- [ ] third');

    const back = toggleTaskItem(toggled, 1, false);
    assert.equal(back.source, '- [x] first\n- [ ] second\n- [ ] third');
  });

  test('toggling a non-task line is a no-op', () => {
    const block = parseMarkdownBlocks('- plain item')[0];
    assert.equal(toggleTaskItem(block, 0).source, block.source);
    assert.equal(toggleTaskItem(block, 99).source, block.source);
  });

  test('progress counts across every task block in the document', () => {
    const mixed = '- [x] a\n\ntext\n\n1. [ ] b\n1. [x] c';
    assert.deepEqual(taskProgress(mixed), { done: 2, total: 3 });
    assert.deepEqual(taskProgress('no tasks here'), { done: 0, total: 0 });
  });

  test('a toggled task block still round-trips into its document', () => {
    const full = 'Intro\n\n- [ ] one\n- [ ] two\n\nOutro';
    const blocks = parseMarkdownBlocks(full);
    const taskBlock = blocks.find((b) => b.kind === 'task-list');
    assert.ok(taskBlock);
    const next = blocks.map((b) => (b === taskBlock ? toggleTaskItem(b, 1) : b));
    assert.equal(serializeMarkdownBlocks(next), 'Intro\n\n- [ ] one\n- [x] two\n\nOutro');
  });
});
