/**
 * Element → source mapping ladder (MIN-369): static HTML workspace lookup via a mocked fetch,
 * framework dev-server debug attributes via a mocked picker transport, and the final 'guess'
 * fallback when both steps come up empty. The server-side matcher itself (unique vs ambiguous
 * signal → exact/probable) is unit-tested in test/server/design-source-map-routes.test.mjs.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { resolveElementSourceMapping } from '../../src/design/source-map.ts';
import type { PickerTransport } from '../../src/design/element-picker.ts';

const baseInput = {
  selector: 'button.cta',
  pageUrl: 'pricing.html',
  tagName: 'button',
  classList: ['cta', 'primary'],
  outerHtmlPreview: '<button id="buy-now" class="cta primary">Buy now</button>',
};

function makeTransport(evalImpl: (expr: string) => Promise<unknown>): PickerTransport {
  return { mode: 'electron', eval: evalImpl, canReadGuest: () => true };
}

describe('resolveElementSourceMapping — static HTML workspace ladder step', () => {
  afterEach(() => {
    // @ts-expect-error test cleanup
    delete globalThis.fetch;
  });

  test('exact match: fetch resolves with a file:line and exact confidence, transport is never consulted', async () => {
    let transportCalled = false;
    let requestedUrl = '';
    globalThis.fetch = (async (input: unknown) => {
      requestedUrl = String(input);
      return {
        ok: true,
        json: async () => ({ file: 'pricing.html', line: 42, confidence: 'exact' }),
      } as Response;
    }) as typeof fetch;
    const transport = makeTransport(async () => {
      transportCalled = true;
      return null;
    });

    const mapping = await resolveElementSourceMapping(baseInput, transport);
    assert.deepEqual(mapping, { file: 'pricing.html', line: 42, confidence: 'exact' });
    assert.equal(transportCalled, false, 'dev-server ladder step should be skipped once step 1 hits');
    assert.match(requestedUrl, /\/api\/design\/source-map\?/);
    assert.match(requestedUrl, /page=pricing\.html/);
    assert.match(requestedUrl, /id=buy-now/);
  });

  test('probable match: server reports ambiguous confidence, passed through unchanged', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({ file: 'pricing.html', line: 7, confidence: 'probable' }),
      }) as Response) as typeof fetch;

    const mapping = await resolveElementSourceMapping(baseInput, null);
    assert.deepEqual(mapping, { file: 'pricing.html', line: 7, confidence: 'probable' });
  });

  test('non-HTML page skips the static step entirely (no fetch call)', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return { ok: true, json: async () => ({ confidence: 'guess' }) } as Response;
    }) as typeof fetch;

    const mapping = await resolveElementSourceMapping(
      { ...baseInput, pageUrl: 'http://localhost:5173/app' },
      null,
    );
    assert.equal(fetchCalled, false);
    assert.deepEqual(mapping, { confidence: 'guess' });
  });

  test('fetch failure (network error) falls through to the dev-server step instead of throwing', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    const transport = makeTransport(async () => ({ file: 'src/App.tsx', line: 12, component: 'App' }));

    const mapping = await resolveElementSourceMapping(baseInput, transport);
    assert.deepEqual(mapping, { file: 'src/App.tsx', line: 12, component: 'App', confidence: 'probable' });
  });

  test('server 200s with confidence guess and no file — falls through to dev-server step', async () => {
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ confidence: 'guess' }) }) as Response) as typeof fetch;
    const transport = makeTransport(async () => ({ file: 'src/App.tsx', component: 'App' }));

    const mapping = await resolveElementSourceMapping(baseInput, transport);
    assert.deepEqual(mapping, { file: 'src/App.tsx', line: undefined, component: 'App', confidence: 'probable' });
  });
});

describe('resolveElementSourceMapping — framework dev-server ladder step', () => {
  afterEach(() => {
    // @ts-expect-error test cleanup
    delete globalThis.fetch;
  });

  test('React fiber _debugSource resolves to a probable file:line + component', async () => {
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ confidence: 'guess' }) }) as Response) as typeof fetch;
    const transport = makeTransport(async () => ({
      file: '/repo/src/components/Cta.tsx',
      line: 18,
      component: 'CtaButton',
    }));

    const mapping = await resolveElementSourceMapping(
      { ...baseInput, pageUrl: 'http://localhost:5173/' },
      transport,
    );
    assert.deepEqual(mapping, {
      file: '/repo/src/components/Cta.tsx',
      line: 18,
      component: 'CtaButton',
      confidence: 'probable',
    });
  });

  test('transport throwing (guest navigated away) falls through to guess, never rejects', async () => {
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ confidence: 'guess' }) }) as Response) as typeof fetch;
    const transport = makeTransport(async () => {
      throw new Error('guest unavailable');
    });

    const mapping = await resolveElementSourceMapping(
      { ...baseInput, pageUrl: 'http://localhost:5173/' },
      transport,
    );
    assert.deepEqual(mapping, { confidence: 'guess' });
  });

  test('null transport (no execJs / iframe) falls straight to guess for a dev-server page', async () => {
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ confidence: 'guess' }) }) as Response) as typeof fetch;

    const mapping = await resolveElementSourceMapping(
      { ...baseInput, pageUrl: 'http://localhost:5173/' },
      null,
    );
    assert.deepEqual(mapping, { confidence: 'guess' });
  });
});

describe('resolveElementSourceMapping — never blocks the pick', () => {
  test('resolves (does not reject) even when every step fails', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    const transport = makeTransport(async () => {
      throw new Error('guest gone');
    });

    const mapping = await resolveElementSourceMapping(baseInput, transport);
    assert.deepEqual(mapping, { confidence: 'guess' });
    // @ts-expect-error test cleanup
    delete globalThis.fetch;
  });
});
