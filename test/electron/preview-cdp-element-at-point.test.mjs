import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

/**
 * One-shot CDP resolve at a point. Requires `npm run electron:build`.
 * Mocks webContents.debugger — no live Chromium.
 */
const { resolveElementAtPoint, fetchCdpNodeAsPicked } = await import(
  '../../electron/dist/preview-cdp-element-at-point.js'
);

const BOX_MODEL = {
  model: { content: [10, 20, 110, 20, 110, 60, 10, 60], width: 100, height: 40 },
};

function makeDebugger(overrides = {}) {
  const calls = [];
  let attached = false;
  const dbg = {
    isAttached() {
      return attached;
    },
    attach() {
      attached = true;
    },
    detach() {
      attached = false;
    },
    async sendCommand(method, params) {
      calls.push({ method, params });
      if (overrides.sendCommand) {
        const custom = await overrides.sendCommand(method, params, calls);
        if (custom !== undefined) return custom;
      }
      switch (method) {
        case 'Runtime.evaluate':
          return { result: { value: 2 } };
        case 'DOM.getDocument':
          return { root: { nodeId: 1 } };
        case 'DOM.getNodeForLocation':
          return { backendNodeId: 42 };
        case 'DOM.getBoxModel':
          return BOX_MODEL;
        case 'DOM.pushNodesByBackendIdsToFrontend':
          return { nodeIds: [77] };
        case 'DOM.describeNode':
          return {
            node: {
              nodeName: 'BUTTON',
              localName: 'button',
              attributes: ['id', 'buy', 'class', 'cta'],
            },
          };
        case 'DOM.getOuterHTML':
          return { outerHTML: '<button id="buy" class="cta">Buy</button>' };
        case 'CSS.getComputedStyleForNode':
          return {
            computedStyle: [
              { name: 'color', value: 'rgb(0, 0, 0)' },
              { name: 'background-color', value: 'rgb(255, 255, 255)' },
              { name: 'font-size', value: '14px' },
              { name: 'line-height', value: '20px' },
              { name: 'font-family', value: 'Inter' },
              { name: 'font-weight', value: '400' },
              { name: 'padding', value: '0px' },
              { name: 'margin', value: '0px' },
              { name: 'display', value: 'inline-block' },
              { name: 'position', value: 'static' },
            ],
          };
        case 'DOM.setAttributeValue':
          return {};
        default:
          return {};
      }
    },
    calls,
    get attached() {
      return attached;
    },
  };
  return dbg;
}

function makeWebContents(dbg) {
  return { debugger: dbg };
}

describe('fetchCdpNodeAsPicked', () => {
  test('returns adaptCdpRawPick shape with selector + rect', async () => {
    const dbg = makeDebugger();
    const picked = await fetchCdpNodeAsPicked(dbg, 42, 7);
    assert.ok(picked);
    assert.equal(picked.uid, 7);
    assert.equal(picked.cssSelector, '#buy');
    assert.equal(picked.tagName, 'button');
    assert.deepEqual(picked.classList, ['cta']);
    assert.equal(picked.boundingRect.width, 100);
    assert.equal(picked.devicePixelRatio, 2);
    assert.ok(dbg.calls.some((c) => c.method === 'DOM.setAttributeValue'));
  });
});

describe('resolveElementAtPoint', () => {
  test('attaches, resolves, and detaches when debugger was free', async () => {
    const dbg = makeDebugger();
    const result = await resolveElementAtPoint(makeWebContents(dbg), 12, 34);
    assert.equal(result.ok, true);
    assert.equal(result.picked.cssSelector, '#buy');
    assert.ok(dbg.calls.some((c) => c.method === 'DOM.getNodeForLocation'));
    assert.equal(dbg.attached, false);
  });

  test('refuses when Design Mode pick session is active', async () => {
    const dbg = makeDebugger();
    const result = await resolveElementAtPoint(makeWebContents(dbg), 1, 1, {
      pickSessionActive: true,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /Design Mode Select/i);
    assert.equal(dbg.attached, false);
  });

  test('does not detach when debugger was already attached', async () => {
    const dbg = makeDebugger();
    dbg.attach();
    const result = await resolveElementAtPoint(makeWebContents(dbg), 5, 5);
    assert.equal(result.ok, true);
    assert.equal(dbg.attached, true);
  });

  test('returns error when no backend node at location', async () => {
    const dbg = makeDebugger({
      async sendCommand(method) {
        if (method === 'DOM.getNodeForLocation') return {};
        return undefined;
      },
    });
    const result = await resolveElementAtPoint(makeWebContents(dbg), 0, 0);
    assert.equal(result.ok, false);
    assert.match(result.error, /No element/i);
  });
});
