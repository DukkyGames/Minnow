import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

/**
 * Build after `npm run electron:build` so dist includes preview-guest-actions.js.
 */
const {
  previewExecJs,
  previewCapturePageBase64,
  previewClearGuest,
  previewGetGuestInfo,
  previewNavigateAwait,
  isNavigationAbortedError,
} = await import('../../electron/dist/preview-guest-actions.js');

function createMockWebContents(overrides = {}) {
  const state = {
    url: 'about:blank',
    title: '',
    loading: false,
    loadCalls: [],
    execCalls: [],
    captureCalls: 0,
    ...overrides,
  };
  return {
    isDestroyed: () => false,
    getURL: () => state.url,
    getTitle: () => state.title,
    isLoading: () => state.loading,
    executeJavaScript: async (code, userGesture) => {
      state.execCalls.push({ code, userGesture });
      if (state.execResult !== undefined) return state.execResult;
      return state.execReturn;
    },
    capturePage: async () => {
      state.captureCalls += 1;
      return {
        toPNG: () => Buffer.from('png-bytes'),
      };
    },
    loadURL: async (url) => {
      state.loadCalls.push(url);
      if (state.loadReject) {
        throw state.loadReject;
      }
      state.url = url;
      state.title = state.titleAfterLoad ?? 'Loaded';
    },
    _state: state,
  };
}

describe('preview guest actions', () => {
  test('previewExecJs calls executeJavaScript with userGesture true', async () => {
    const wc = createMockWebContents({ execReturn: 42 });
    const val = await previewExecJs(wc, '1 + 1');
    assert.equal(val, 42);
    assert.equal(wc._state.execCalls.length, 1);
    assert.equal(wc._state.execCalls[0].userGesture, true);
    assert.match(wc._state.execCalls[0].code, /try \{ return \(1 \+ 1\)/);
  });

  test('previewExecJs returns guest JS errors instead of throwing', async () => {
    const wc = createMockWebContents({
      execReturn: { __execError: 'boom' },
    });
    const val = await previewExecJs(wc, 'throw new Error("boom")');
    assert.deepEqual(val, { __execError: 'boom' });
  });

  test('previewCapturePageBase64 returns base64 PNG', async () => {
    const wc = createMockWebContents();
    const b64 = await previewCapturePageBase64(wc);
    assert.equal(b64, Buffer.from('png-bytes').toString('base64'));
    assert.equal(wc._state.captureCalls, 1);
  });

  test('previewGetGuestInfo returns url title loading', () => {
    const wc = createMockWebContents({
      url: 'https://example.com',
      title: 'Example',
      loading: true,
    });
    assert.deepEqual(previewGetGuestInfo(wc), {
      url: 'https://example.com',
      title: 'Example',
      loading: true,
    });
  });

  test('previewNavigateAwait resolves on successful loadURL', async () => {
    const wc = createMockWebContents({ titleAfterLoad: 'Minnow' });
    const result = await previewNavigateAwait(wc, 'http://127.0.0.1:5173/');
    assert.equal(result.ok, true);
    assert.equal(result.url, 'http://127.0.0.1:5173/');
    assert.equal(result.title, 'Minnow');
    assert.deepEqual(wc._state.loadCalls, ['http://127.0.0.1:5173/']);
  });

  test('previewNavigateAwait returns error when loadURL rejects', async () => {
    const wc = createMockWebContents({ loadReject: new Error('ERR_FAILED') });
    const result = await previewNavigateAwait(wc, 'https://bad.test/');
    assert.equal(result.ok, false);
    assert.match(result.errorDescription ?? '', /ERR_FAILED/);
  });

  test('isNavigationAbortedError detects ERR_ABORTED', () => {
    assert.equal(isNavigationAbortedError({ errno: -3, code: 'ERR_ABORTED' }), true);
    assert.equal(isNavigationAbortedError(new Error('ERR_ABORTED (-3) loading about:blank')), true);
    assert.equal(isNavigationAbortedError(new Error('ERR_FAILED')), false);
  });

  test('previewClearGuest skips when guest is already blank', async () => {
    const wc = createMockWebContents({ url: 'about:blank', loading: false });
    await previewClearGuest(wc);
    assert.deepEqual(wc._state.loadCalls, []);
  });

  test('previewClearGuest loads about:blank', async () => {
    const wc = createMockWebContents({ url: 'https://example.com/' });
    await previewClearGuest(wc);
    assert.deepEqual(wc._state.loadCalls, ['about:blank']);
    assert.equal(wc._state.url, 'about:blank');
  });

  test('previewClearGuest ignores ERR_ABORTED from loadURL', async () => {
    const wc = createMockWebContents({
      url: 'https://example.com/',
      loadReject: Object.assign(new Error('ERR_ABORTED (-3) loading about:blank'), {
        errno: -3,
        code: 'ERR_ABORTED',
      }),
    });
    await previewClearGuest(wc);
    assert.deepEqual(wc._state.loadCalls, ['about:blank']);
  });

  test('previewClearGuest rethrows non-abort loadURL errors', async () => {
    const wc = createMockWebContents({
      url: 'https://example.com/',
      loadReject: new Error('ERR_FAILED'),
    });
    await assert.rejects(() => previewClearGuest(wc), /ERR_FAILED/);
  });
});
