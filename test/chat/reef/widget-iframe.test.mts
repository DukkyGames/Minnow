/**
 * Reef widget iframe srcdoc and sandbox policy.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildReefWidgetSrcdoc,
  getReefImportMapJsonForTests,
  resetReefWidgetIdCounterForTests,
} from '../../../src/chat/reef/widget-iframe.ts';

describe('widget-iframe', () => {
  test('srcdoc contains CSP, importmap, and widget body', () => {
    resetReefWidgetIdCounterForTests();
    const srcdoc = buildReefWidgetSrcdoc({
      widgetHtml: '<p id="tip">Tip calc</p>',
      widgetId: 'w-test-1',
      themeVars: { '--bg': '#eee' },
    });
    assert.match(srcdoc, /Content-Security-Policy/);
    assert.match(srcdoc, /cdnjs\.cloudflare\.com/);
    assert.match(srcdoc, /esm\.sh/);
    assert.match(srcdoc, /importmap/);
    assert.match(srcdoc, /Tip calc/);
    assert.match(srcdoc, /w-test-1/);
    assert.match(srcdoc, /react@19/);
    assert.doesNotMatch(srcdoc, /react@19\?dev/);
    assert.match(srcdoc, /requestResize/);
    assert.match(srcdoc, /width=device-width/);
    assert.match(srcdoc, /\.rw-chart/);
    assert.match(srcdoc, /\.mw-chart/);
    assert.match(srcdoc, /min-height: 220px/);
    assert.match(srcdoc, /ensureChartParentsSized/);
    assert.match(srcdoc, /scheduleDelayedResizePasses/);
    assert.match(srcdoc, /setTimeout\(scheduleResizePost, 400\)/);
    assert.match(srcdoc, /tryEmitValidateAfterResize/);
    assert.match(srcdoc, /emitValidateResultOnce/);
    assert.match(srcdoc, /validateResult/);
    assert.match(srcdoc, /captureWidgetError/);
  });

  test('JSX srcdoc includes css var guard before Babel', () => {
    const srcdoc = buildReefWidgetSrcdoc({
      widgetHtml: '<div id="r"></div><script type="module">export default <span className="x"/>;</script>',
      widgetId: 'jsx-guard',
      themeVars: { '--bg': '#eee' },
    });
    assert.match(srcdoc, /__quoteCssVarsInJsx/);
    assert.match(srcdoc, /text\/jsx/);
  });

  test('import map pins curated libraries', () => {
    const json = getReefImportMapJsonForTests();
    assert.match(json, /"react"/);
    assert.match(json, /recharts/);
  });
});
