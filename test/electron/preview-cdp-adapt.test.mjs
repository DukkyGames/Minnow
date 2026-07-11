import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

/**
 * Build after `npm run electron:build` so dist includes preview-cdp-adapt.js.
 * Pure data-transform module (no `electron` import) — same testing pattern as
 * preview-guest-actions.ts / preview-instance-registry.ts. Exercises the CDP → PickedElement
 * adapter with mocked DOM/CSS protocol responses; no live debugger session required (MIN-370 P7).
 */
const { adaptCdpRawPick, contrastRatioOfCdp } = await import('../../electron/dist/preview-cdp-adapt.js');

function computedStyle(overrides = {}) {
  const base = {
    'font-size': '14px',
    'line-height': '20px',
    'font-family': 'Inter, sans-serif',
    'font-weight': '400',
    color: 'rgb(20, 20, 20)',
    'background-color': 'rgb(255, 255, 255)',
    padding: '4px 8px',
    margin: '0px',
    gap: 'normal',
    display: 'flex',
    position: 'static',
  };
  return Object.entries({ ...base, ...overrides }).map(([name, value]) => ({ name, value }));
}

function boxModel(x, y, width, height) {
  // CDP content quad: clockwise from top-left [x1,y1, x2,y2, x3,y3, x4,y4]
  return {
    content: [x, y, x + width, y, x + width, y + height, x, y + height],
  };
}

describe('adaptCdpRawPick', () => {
  test('id attribute produces an id selector', () => {
    const picked = adaptCdpRawPick(
      {
        attributes: ['id', 'buy-now', 'class', 'cta primary'],
        nodeName: 'BUTTON',
        boxModel: boxModel(12, 24, 96, 32),
        outerHTML: '<button id="buy-now" class="cta primary">Buy now</button>',
        computedStyle: computedStyle(),
        devicePixelRatio: 2,
        shiftKey: false,
      },
      1,
    );

    assert.equal(picked.cssSelector, '#buy-now');
    assert.equal(picked.tagName, 'button');
    assert.deepEqual(picked.classList, ['cta', 'primary']);
    assert.equal(picked.uid, 1);
    assert.equal(picked.devicePixelRatio, 2);
    assert.equal(picked.shiftKey, false);
  });

  test('falls back to tag + class selector when no id', () => {
    const picked = adaptCdpRawPick(
      {
        attributes: ['class', 'cta primary'],
        nodeName: 'BUTTON',
        boxModel: boxModel(0, 0, 10, 10),
        outerHTML: '<button class="cta primary">Buy</button>',
        computedStyle: computedStyle(),
        devicePixelRatio: 1,
        shiftKey: false,
      },
      2,
    );
    assert.equal(picked.cssSelector, 'button.cta.primary');
  });

  test('drops unstable hashed/css-in-js classes from the fallback selector', () => {
    const picked = adaptCdpRawPick(
      {
        attributes: ['class', 'css-a1b2c3 sc-9f8e7d stable-name'],
        nodeName: 'DIV',
        boxModel: boxModel(0, 0, 10, 10),
        outerHTML: '<div></div>',
        computedStyle: computedStyle(),
        devicePixelRatio: 1,
        shiftKey: false,
      },
      3,
    );
    assert.equal(picked.cssSelector, 'div.stable-name');
  });

  test('bare tag selector when there is no id or stable class', () => {
    const picked = adaptCdpRawPick(
      {
        attributes: [],
        nodeName: 'SPAN',
        boxModel: boxModel(0, 0, 10, 10),
        outerHTML: '<span></span>',
        computedStyle: computedStyle(),
        devicePixelRatio: 1,
        shiftKey: false,
      },
      4,
    );
    assert.equal(picked.cssSelector, 'span');
  });

  test('quad → axis-aligned bounding rect', () => {
    const picked = adaptCdpRawPick(
      {
        attributes: [],
        nodeName: 'DIV',
        boxModel: boxModel(12, 24, 96, 32),
        outerHTML: '<div></div>',
        computedStyle: computedStyle(),
        devicePixelRatio: 1,
        shiftKey: false,
      },
      1,
    );
    assert.deepEqual(picked.boundingRect, { x: 12, y: 24, width: 96, height: 32 });
  });

  test('missing/invalid devicePixelRatio falls back to 1', () => {
    const picked = adaptCdpRawPick(
      {
        attributes: [],
        nodeName: 'DIV',
        boxModel: boxModel(0, 0, 10, 10),
        outerHTML: '<div></div>',
        computedStyle: computedStyle(),
        devicePixelRatio: Number.NaN,
        shiftKey: false,
      },
      1,
    );
    assert.equal(picked.devicePixelRatio, 1);
  });

  test('styles digest includes font/color/spacing/layout fields', () => {
    const picked = adaptCdpRawPick(
      {
        attributes: [],
        nodeName: 'DIV',
        boxModel: boxModel(0, 0, 10, 10),
        outerHTML: '<div></div>',
        computedStyle: computedStyle({ gap: '8px' }),
        devicePixelRatio: 1,
        shiftKey: false,
      },
      1,
    );
    assert.match(picked.stylesDigest, /font:14px\/20px Inter 400/);
    assert.match(picked.stylesDigest, /color:rgb\(20, 20, 20\)/);
    assert.match(picked.stylesDigest, /bg:rgb\(255, 255, 255\)/);
    assert.match(picked.stylesDigest, /gap:8px/);
    assert.match(picked.stylesDigest, /layout:flex/);
  });

  test('aria-label wins over alt and text content for accessible name', () => {
    const picked = adaptCdpRawPick(
      {
        attributes: ['aria-label', 'Close dialog', 'alt', 'X icon'],
        nodeName: 'BUTTON',
        boxModel: boxModel(0, 0, 10, 10),
        outerHTML: '<button aria-label="Close dialog" alt="X icon">×</button>',
        computedStyle: computedStyle(),
        devicePixelRatio: 1,
        shiftKey: false,
      },
      1,
    );
    assert.equal(picked.accessibleName, 'Close dialog');
  });

  test('falls back to stripped outerHTML text when no aria-label/alt', () => {
    const picked = adaptCdpRawPick(
      {
        attributes: [],
        nodeName: 'BUTTON',
        boxModel: boxModel(0, 0, 10, 10),
        outerHTML: '<button><span>Buy</span> now</button>',
        computedStyle: computedStyle(),
        devicePixelRatio: 1,
        shiftKey: false,
      },
      1,
    );
    assert.equal(picked.accessibleName, 'Buy now');
  });

  test('contrast ratio computed from color vs background-color', () => {
    const picked = adaptCdpRawPick(
      {
        attributes: [],
        nodeName: 'DIV',
        boxModel: boxModel(0, 0, 10, 10),
        outerHTML: '<div></div>',
        computedStyle: computedStyle({
          color: 'rgb(0, 0, 0)',
          'background-color': 'rgb(255, 255, 255)',
        }),
        devicePixelRatio: 1,
        shiftKey: false,
      },
      1,
    );
    assert.equal(picked.contrastRatio, 21);
  });

  test('contrast ratio is null when background is transparent', () => {
    const picked = adaptCdpRawPick(
      {
        attributes: [],
        nodeName: 'DIV',
        boxModel: boxModel(0, 0, 10, 10),
        outerHTML: '<div></div>',
        computedStyle: computedStyle({ 'background-color': 'transparent' }),
        devicePixelRatio: 1,
        shiftKey: false,
      },
      1,
    );
    assert.equal(picked.contrastRatio, null);
  });

  test('shiftKey passes through', () => {
    const picked = adaptCdpRawPick(
      {
        attributes: [],
        nodeName: 'DIV',
        boxModel: boxModel(0, 0, 10, 10),
        outerHTML: '<div></div>',
        computedStyle: computedStyle(),
        devicePixelRatio: 1,
        shiftKey: true,
      },
      1,
    );
    assert.equal(picked.shiftKey, true);
  });

  test('uid passes through unchanged (stamped by the CDP orchestrator, not the adapter)', () => {
    const picked = adaptCdpRawPick(
      {
        attributes: [],
        nodeName: 'DIV',
        boxModel: boxModel(0, 0, 10, 10),
        outerHTML: '<div></div>',
        computedStyle: computedStyle(),
        devicePixelRatio: 1,
        shiftKey: false,
      },
      42,
    );
    assert.equal(picked.uid, 42);
  });

  test('outerHTMLPreview is capped at 200 chars with whitespace collapsed', () => {
    const longHtml = `<div>${'x'.repeat(300)}</div>`;
    const picked = adaptCdpRawPick(
      {
        attributes: [],
        nodeName: 'DIV',
        boxModel: boxModel(0, 0, 10, 10),
        outerHTML: longHtml,
        computedStyle: computedStyle(),
        devicePixelRatio: 1,
        shiftKey: false,
      },
      1,
    );
    assert.ok(picked.outerHTMLPreview.length <= 200);
  });
});

describe('contrastRatioOfCdp', () => {
  test('black on white is the maximum 21:1', () => {
    const ratio = contrastRatioOfCdp({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 });
    assert.equal(ratio, 21);
  });

  test('same color on itself is 1:1', () => {
    const ratio = contrastRatioOfCdp(
      { r: 128, g: 128, b: 128, a: 1 },
      { r: 128, g: 128, b: 128, a: 1 },
    );
    assert.equal(ratio, 1);
  });
});
