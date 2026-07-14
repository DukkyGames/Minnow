/**
 * Design Mode drawn-shape → composer design-reference attachments (MIN-367).
 * Mirrors test/attachments/element-ref.test.mts.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Window } from 'happy-dom';
import {
  addDesignRefToComposer,
  designRefHistoryBlock,
  formatDesignRefLabel,
  isDesignRefAttachment,
  structuredIntentForShape,
} from '../../src/attachments/design-ref.ts';
import { clearAttachments, getPendingAttachments } from '../../src/attachments/store.ts';
import type { Attachment } from '../../src/attachments/types.ts';
import type { DesignShape } from '../../src/design/shape-model.ts';

function setupDom(): void {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.window = window as unknown as Window & typeof globalThis.window;

  const input = document.createElement('textarea');
  input.id = 'msgInput';
  document.body.appendChild(input);

  const preview = document.createElement('div');
  preview.id = 'attachPreview';
  preview.className = 'hidden';
  document.body.appendChild(preview);
}

const arrowShape: DesignShape = {
  id: 'dshape-1',
  kind: 'arrow',
  points: [
    { x: 10, y: 20 },
    { x: 90, y: 25 },
  ],
  anchor: { type: 'element', uid: 7, selector: '[data-mn-uid="7"]' },
  createdAt: 1700000000000,
};

const rectShape: DesignShape = {
  id: 'dshape-2',
  kind: 'rect',
  rect: { x: 5, y: 5, width: 40, height: 30 },
  anchor: { type: 'page', x: 5, y: 5, scrollX: 0, scrollY: 100 },
  createdAt: 1700000000001,
};

describe('formatDesignRefLabel', () => {
  it('uses the shape kind and the page basename', () => {
    assert.equal(formatDesignRefLabel('arrow', 'pricing.html'), 'arrow — pricing.html');
  });

  it('labels pen strokes as "sketch"', () => {
    assert.equal(formatDesignRefLabel('pen', 'pricing.html'), 'sketch — pricing.html');
  });

  it('falls back to the kind alone when there is no page', () => {
    assert.equal(formatDesignRefLabel('rect', ''), 'rect');
  });
});

describe('designRefHistoryBlock', () => {
  it('serializes an element-anchored shape with kind/page/anchor attributes', () => {
    const intentText = structuredIntentForShape(arrowShape);
    const block = designRefHistoryBlock({ shape: arrowShape, pageUrl: 'pricing.html', intentText });
    assert.match(block, /^<design-ref kind="arrow" page="pricing\.html" anchor="element"/);
    assert.match(block, /anchorSelector="\[data-mn-uid='7'\]"/);
    assert.match(block, /anchorUid="7"/);
    assert.match(block, /\narrow from 10,20 to 90,25 = move\/motion intent\n<\/design-ref>$/);
  });

  it('serializes a page-anchored shape with anchorX/anchorY attributes', () => {
    const intentText = structuredIntentForShape(rectShape);
    const block = designRefHistoryBlock({ shape: rectShape, pageUrl: 'pricing.html', intentText });
    assert.match(block, /anchor="page" anchorX="5" anchorY="5"/);
    assert.doesNotMatch(block, /anchorSelector=/);
  });

  it('adds an image attribute only when imageName is provided', () => {
    const intentText = structuredIntentForShape(rectShape);
    const withImage = designRefHistoryBlock({
      shape: rectShape,
      pageUrl: 'pricing.html',
      intentText,
      imageName: 'rect — pricing.html',
    });
    assert.match(withImage, /image="rect — pricing\.html"/);

    const withoutImage = designRefHistoryBlock({ shape: rectShape, pageUrl: 'pricing.html', intentText });
    assert.doesNotMatch(withoutImage, /image="/);
  });
});

describe('addDesignRefToComposer', () => {
  afterEach(() => {
    clearAttachments();
    document.body.replaceChildren();
  });

  it('queues a designRef attachment with the shape, page, and composited image', () => {
    setupDom();
    const attachment = addDesignRefToComposer({
      shape: arrowShape,
      pageUrl: 'pricing.html',
      compositedDataUrl: 'data:image/png;base64,COMPOSITED',
    });
    assert.ok(attachment);
    const pending = getPendingAttachments();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].kind, 'designRef');
    assert.equal(pending[0].name, 'arrow — pricing.html');
    assert.deepEqual(pending[0].shape, arrowShape);
    assert.equal(pending[0].pageUrl, 'pricing.html');
    assert.equal(pending[0].compositedDataUrl, 'data:image/png;base64,COMPOSITED');
    assert.equal(pending[0].intentText, 'arrow from 10,20 to 90,25 = move/motion intent');
  });

  it('never dedupes — a second shape is always a second chip, even on the same page', () => {
    setupDom();
    addDesignRefToComposer({ shape: arrowShape, pageUrl: 'pricing.html' });
    addDesignRefToComposer({ shape: rectShape, pageUrl: 'pricing.html' });
    assert.equal(getPendingAttachments().length, 2);
  });

  it('works without a composited image (capture failure still queues the intent text)', () => {
    setupDom();
    const attachment = addDesignRefToComposer({ shape: rectShape, pageUrl: 'pricing.html' });
    assert.ok(attachment);
    assert.equal(attachment?.compositedDataUrl, undefined);
    assert.equal(attachment?.intentText, 'rect at 5,5 40×30 = region of interest');
  });
});

describe('isDesignRefAttachment', () => {
  it('accepts a fully-populated designRef attachment', () => {
    const attachment: Attachment = {
      id: 'd1',
      name: 'arrow — pricing.html',
      kind: 'designRef',
      mimeType: 'text/plain',
      size: 10,
      shape: arrowShape,
      pageUrl: 'pricing.html',
      intentText: 'arrow from 10,20 to 90,25 = move/motion intent',
    };
    assert.equal(isDesignRefAttachment(attachment), true);
  });

  it('rejects other kinds and incomplete designRef rows', () => {
    assert.equal(
      isDesignRefAttachment({
        id: 'd2',
        name: 'x',
        kind: 'elementRef',
        mimeType: 'text/html',
        size: 1,
      }),
      false,
    );
    assert.equal(
      isDesignRefAttachment({
        id: 'd3',
        name: 'x',
        kind: 'designRef',
        mimeType: 'text/plain',
        size: 1,
      }),
      false,
    );
  });
});
