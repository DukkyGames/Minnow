import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHistoryUserContent,
  historyUserContentHasAttachments,
} from '../../src/chat/user-message-parts.ts';

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
