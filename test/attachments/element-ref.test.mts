/**
 * Design Mode element-picker capture → composer element-reference attachments (MIN-366).
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Window } from 'happy-dom';
import {
  addElementRefToComposer,
  elementRefHistoryBlock,
  formatElementRefLabel,
  isElementRefAttachment,
} from '../../src/attachments/element-ref.ts';
import {
  clearAttachments,
  getPendingAttachments,
  removeAttachment,
} from '../../src/attachments/store.ts';
import type { Attachment } from '../../src/attachments/types.ts';

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

const baseInput = {
  selector: 'button.cta',
  uid: 12,
  pageUrl: 'pricing.html',
  tagName: 'button',
  classList: ['cta', 'primary'],
  outerHtmlPreview: '<button class="cta primary">Buy now</button>',
  rect: { x: 120, y: 240, width: 96, height: 32 },
  stylesDigest: 'font:14px/20px Inter 600; color:rgb(17, 24, 39); bg:rgb(255, 255, 255); p:8px 16px; layout:flex',
};

describe('formatElementRefLabel', () => {
  it('uses the last selector segment and the page basename', () => {
    assert.equal(
      formatElementRefLabel('body > div.hero > button.cta', 'pricing.html'),
      'button.cta — pricing.html',
    );
  });

  it('reads the basename out of a full URL', () => {
    assert.equal(
      formatElementRefLabel('#hero', 'https://example.com/app/pricing/'),
      '#hero — pricing',
    );
  });

  it('falls back to the selector alone when there is no page', () => {
    assert.equal(formatElementRefLabel('#hero', ''), '#hero');
  });
});

describe('elementRefHistoryBlock', () => {
  it('serializes selector, uid, page, styles and rect attributes', () => {
    const block = elementRefHistoryBlock(baseInput);
    assert.match(block, /^<element-ref selector="button\.cta" uid="12" page="pricing\.html"/);
    assert.match(block, /tag="button"/);
    assert.match(block, /classes="cta primary"/);
    assert.match(block, /rect="120,240,96,32"/);
    assert.match(block, /styles="font:14px\/20px Inter 600[^"]*"/);
    assert.match(block, /<button class="cta primary">Buy now<\/button>\n<\/element-ref>$/);
  });

  it('omits the uid attribute when uid is null', () => {
    const block = elementRefHistoryBlock({ ...baseInput, uid: null });
    assert.doesNotMatch(block, /uid="/);
  });

  it('adds an image attribute only when imageName is provided', () => {
    const withImage = elementRefHistoryBlock({ ...baseInput, imageName: 'button.cta — pricing.html' });
    assert.match(withImage, /image="button\.cta — pricing\.html"/);

    const withoutImage = elementRefHistoryBlock(baseInput);
    assert.doesNotMatch(withoutImage, /image="/);
  });
});

describe('addElementRefToComposer', () => {
  afterEach(() => {
    clearAttachments();
    document.body.replaceChildren();
  });

  it('queues an elementRef attachment with the full picker payload', () => {
    setupDom();
    const attachment = addElementRefToComposer({ ...baseInput, croppedDataUrl: 'data:image/png;base64,AAA' });
    assert.ok(attachment);
    const pending = getPendingAttachments();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].kind, 'elementRef');
    assert.equal(pending[0].name, 'button.cta — pricing.html');
    assert.equal(pending[0].selector, 'button.cta');
    assert.equal(pending[0].uid, 12);
    assert.equal(pending[0].pageUrl, 'pricing.html');
    assert.equal(pending[0].tagName, 'button');
    assert.deepEqual(pending[0].classList, ['cta', 'primary']);
    assert.deepEqual(pending[0].rect, baseInput.rect);
    assert.equal(pending[0].stylesDigest, baseInput.stylesDigest);
    assert.equal(pending[0].croppedDataUrl, 'data:image/png;base64,AAA');
  });

  it('dedupes by page + uid, keeping the first chip', () => {
    setupDom();
    const first = addElementRefToComposer(baseInput);
    const second = addElementRefToComposer({ ...baseInput, outerHtmlPreview: '<button>changed</button>' });
    assert.equal(getPendingAttachments().length, 1);
    assert.equal(first?.id, second?.id);
  });

  it('dedupes by page + selector when uid is null', () => {
    setupDom();
    addElementRefToComposer({ ...baseInput, uid: null });
    addElementRefToComposer({ ...baseInput, uid: null });
    assert.equal(getPendingAttachments().length, 1);
  });

  it('does not dedupe across different pages', () => {
    setupDom();
    addElementRefToComposer(baseInput);
    addElementRefToComposer({ ...baseInput, pageUrl: 'checkout.html' });
    assert.equal(getPendingAttachments().length, 2);
  });

  it('removal behaves like other attachments (removeAttachment by id)', () => {
    setupDom();
    const attachment = addElementRefToComposer(baseInput);
    assert.equal(getPendingAttachments().length, 1);
    removeAttachment(attachment!.id);
    assert.equal(getPendingAttachments().length, 0);
  });

  it('ignores picks with an empty selector', () => {
    setupDom();
    const attachment = addElementRefToComposer({ ...baseInput, selector: '   ' });
    assert.equal(attachment, null);
    assert.equal(getPendingAttachments().length, 0);
  });
});

describe('isElementRefAttachment', () => {
  it('accepts a fully-populated elementRef attachment', () => {
    const attachment: Attachment = {
      id: 'a1',
      name: 'button.cta — pricing.html',
      kind: 'elementRef',
      mimeType: 'text/html',
      size: 10,
      selector: 'button.cta',
      pageUrl: 'pricing.html',
      tagName: 'button',
      classList: ['cta'],
      rect: { x: 0, y: 0, width: 1, height: 1 },
      stylesDigest: 'font:14px/20px Inter 400',
      outerHtmlPreview: '<button class="cta"></button>',
    };
    assert.equal(isElementRefAttachment(attachment), true);
  });

  it('rejects other kinds and incomplete elementRef rows', () => {
    assert.equal(
      isElementRefAttachment({
        id: 'a2',
        name: 'x',
        kind: 'image',
        mimeType: 'image/png',
        size: 1,
      }),
      false,
    );
    assert.equal(
      isElementRefAttachment({
        id: 'a3',
        name: 'x',
        kind: 'elementRef',
        mimeType: 'text/html',
        size: 1,
      }),
      false,
    );
  });
});
