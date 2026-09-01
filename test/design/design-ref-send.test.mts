/**
 * Draw & Comment tool send-serialization path (MIN-367 acceptance): a queued designRef
 * attachment must produce a composited-image placeholder + structured intent text in both the
 * persisted-history string builder and the VLM multimodal payload builder.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildHistoryUserContent, buildVlmUserApiContent } from '../../src/chat/build-api-messages.ts';
import type { Attachment } from '../../src/attachments/types.ts';
import type { DesignShape } from '../../src/design/shape-model.ts';

const arrowShape: DesignShape = {
  id: 'dshape-1',
  kind: 'arrow',
  points: [
    { x: 10, y: 20 },
    { x: 90, y: 25 },
  ],
  label: 'move the button here',
  anchor: { type: 'element', uid: 7, selector: 'button.cta' },
  createdAt: 1700000000000,
};

const labelAttachment: Attachment = {
  id: 'dref-1',
  name: 'arrow — pricing.html',
  kind: 'designRef',
  mimeType: 'text/plain',
  size: 10,
  shape: arrowShape,
  pageUrl: 'pricing.html',
  compositedDataUrl: 'data:image/png;base64,COMPOSITED',
  intentText: 'arrow from 10,20 to 90,25 = move/motion intent: move the button here',
};

describe('buildHistoryUserContent — designRef send serialization', () => {
  test('emits a <design-ref> block plus an [image: name] placeholder for the composited crop', () => {
    const content = buildHistoryUserContent('please move this', [labelAttachment]);
    assert.match(content, /please move this/);
    assert.match(content, /<design-ref kind="arrow" page="pricing\.html" anchor="element"/);
    assert.match(content, /arrow from 10,20 to 90,25 = move\/motion intent: move the button here/);
    assert.match(content, /\[image: arrow — pricing\.html\]/);
  });

  test('omits the image placeholder when there is no composited crop', () => {
    const withoutImage: Attachment = { ...labelAttachment, compositedDataUrl: undefined };
    const content = buildHistoryUserContent('', [withoutImage]);
    assert.doesNotMatch(content, /\[image:/);
    assert.match(content, /<design-ref/);
  });
});

describe('buildVlmUserApiContent — designRef send serialization', () => {
  test('text part carries the structured intent; image_url part carries the composited crop', () => {
    const parts = buildVlmUserApiContent('please move this', [labelAttachment]);
    const textPart = parts.find((p) => p.type === 'text');
    const imagePart = parts.find((p) => p.type === 'image_url');
    assert.ok(textPart, 'expected a text part');
    assert.match((textPart as { text: string }).text, /arrow from 10,20 to 90,25 = move\/motion intent/);
    assert.ok(imagePart, 'expected an image_url part for the composited crop');
    assert.equal(
      (imagePart as { image_url: { url: string } }).image_url.url,
      'data:image/png;base64,COMPOSITED',
    );
  });

  test('no image_url part when the shape has no composited crop', () => {
    const withoutImage: Attachment = { ...labelAttachment, compositedDataUrl: undefined };
    const parts = buildVlmUserApiContent('', [withoutImage]);
    assert.equal(parts.some((p) => p.type === 'image_url'), false);
  });
});
