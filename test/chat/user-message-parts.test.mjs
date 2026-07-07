import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHistoryUserContent,
  historyUserContentHasAttachments,
} from '../../src/chat/user-message-parts.ts';
import { designRefHistoryBlock } from '../../src/attachments/design-ref-format.ts';

describe('parseHistoryUserContent', () => {
  test('extracts prose without file bodies', () => {
    const content = [
      'Please review this',
      '<file name="foo.ts">',
      'export const x = 1',
      '</file>',
    ].join('\n');

    const parsed = parseHistoryUserContent(content);
    assert.equal(parsed.text, 'Please review this');
    assert.equal(parsed.files.length, 1);
    assert.equal(parsed.files[0].name, 'foo.ts');
    assert.equal(parsed.files[0].body, 'export const x = 1');
  });

  test('extracts image placeholders', () => {
    const content = 'Look at this\n\n[image: shot.png]';
    const parsed = parseHistoryUserContent(content);
    assert.equal(parsed.text, 'Look at this');
    assert.deepEqual(parsed.images, [{ name: 'shot.png' }]);
  });

  test('extracts code-ref blocks for link UI', () => {
    const content = [
      'Check this',
      '<code-ref path="index.html" start="15" end="36">',
      '<div>hello</div>',
      '</code-ref>',
    ].join('\n');

    const parsed = parseHistoryUserContent(content);
    assert.equal(parsed.text, 'Check this');
    assert.equal(parsed.codeRefs.length, 1);
    assert.equal(parsed.codeRefs[0].workspacePath, 'index.html');
    assert.equal(parsed.codeRefs[0].startLine, 15);
    assert.equal(parsed.codeRefs[0].endLine, 36);
    assert.equal(parsed.codeRefs[0].body, '<div>hello</div>');
  });

  test('extracts design-ref blocks (element-anchored) with the co-emitted image placeholder', () => {
    const shape = {
      id: 'dshape-1',
      kind: 'arrow',
      points: [
        { x: 10, y: 20 },
        { x: 90, y: 25 },
      ],
      anchor: { type: 'element', uid: 7, selector: 'button.cta' },
      createdAt: 0,
    };
    const block = designRefHistoryBlock({
      shape,
      pageUrl: 'pricing.html',
      intentText: 'arrow from 10,20 to 90,25 = move/motion intent',
      imageName: 'arrow — pricing.html',
    });
    const content = `Move this button\n\n${block}\n\n[image: arrow — pricing.html]`;

    const parsed = parseHistoryUserContent(content);
    assert.equal(parsed.text, 'Move this button');
    assert.equal(parsed.designRefs.length, 1);
    const ref = parsed.designRefs[0];
    assert.equal(ref.kind, 'arrow');
    assert.equal(ref.pageUrl, 'pricing.html');
    assert.deepEqual(ref.anchor, { type: 'element', uid: 7, selector: 'button.cta' });
    assert.equal(ref.imageName, 'arrow — pricing.html');
    assert.equal(ref.intentText, 'arrow from 10,20 to 90,25 = move/motion intent');
    // parseHistoryUserContent still reports the co-emitted [image: …] placeholder in `images`
    // (same as element-ref); user-message-bubble.ts is what de-dupes it against designRefs so
    // the chip isn't rendered twice.
    assert.deepEqual(parsed.images, [{ name: 'arrow — pricing.html' }]);
  });

  test('extracts design-ref blocks (page-anchored, no image)', () => {
    const shape = {
      id: 'dshape-2',
      kind: 'rect',
      rect: { x: 5, y: 5, width: 40, height: 30 },
      anchor: { type: 'page', x: 5, y: 5, scrollX: 0, scrollY: 100 },
      createdAt: 0,
    };
    const block = designRefHistoryBlock({
      shape,
      pageUrl: 'pricing.html',
      intentText: 'rect at 5,5 40×30 = region of interest',
    });

    const parsed = parseHistoryUserContent(block);
    assert.equal(parsed.designRefs.length, 1);
    const ref = parsed.designRefs[0];
    assert.equal(ref.kind, 'rect');
    assert.deepEqual(ref.anchor, { type: 'page', x: 5, y: 5 });
    assert.equal(ref.imageName, null);
  });

  test('detects attachment markers', () => {
    assert.equal(historyUserContentHasAttachments('[image: a.png]'), true);
    assert.equal(
      historyUserContentHasAttachments('<file name="x">\nbody\n</file>'),
      true,
    );
    assert.equal(
      historyUserContentHasAttachments(
        '<code-ref path="a.ts" start="1" end="2">\nx\n</code-ref>',
      ),
      true,
    );
    assert.equal(historyUserContentHasAttachments('plain hello'), false);
  });
});
