import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { detectEmbedBlockedFrame } from '../../src/ui/preview-embed-detect.ts';

describe('preview embed detect', () => {
  test('detects chrome-error iframe location', () => {
    assert.equal(
      detectEmbedBlockedFrame('chrome-error://chromewebdata/', ''),
      true,
    );
  });

  test('detects X-Frame-Options text in error page', () => {
    assert.equal(
      detectEmbedBlockedFrame(
        'https://www.google.com/',
        "Refused to display 'https://www.google.com/' in a frame because it set 'X-Frame-Options' to 'sameorigin'.",
      ),
      true,
    );
  });

  test('does not flag about:blank in external mode', () => {
    assert.equal(
      detectEmbedBlockedFrame('about:blank', '', { externalUrlMode: true }),
      false,
    );
  });

  test('cross-origin success has no readable href and empty body', () => {
    assert.equal(detectEmbedBlockedFrame('', ''), false);
  });
});
