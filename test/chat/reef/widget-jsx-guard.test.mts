/**
 * Reef JSX guard — auto-quote unquoted var(--*) in style objects.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { quoteUnquotedCssVarsInJsxScript } from '../../../src/chat/reef/widget-jsx-guard.ts';
import { buildReefWidgetSrcdoc } from '../../../src/chat/reef/widget-iframe.ts';

describe('widget-jsx-guard', () => {
  test('quotes bare var(--token) after colon', () => {
    const input = "style={{ color: var(--text), margin: var(--spacing) }}";
    const { text, fixCount } = quoteUnquotedCssVarsInJsxScript(input);
    assert.equal(fixCount, 2);
    assert.match(text, /color: 'var\(--text\)'/);
    assert.match(text, /margin: 'var\(--spacing\)'/);
  });

  test('leaves already-quoted values unchanged', () => {
    const input = "style={{ color: 'var(--text)' }}";
    const { text, fixCount } = quoteUnquotedCssVarsInJsxScript(input);
    assert.equal(fixCount, 0);
    assert.equal(text, input);
  });

  test('srcdoc JSX runner includes css var guard', () => {
    const srcdoc = buildReefWidgetSrcdoc({
      widgetHtml: '<div id="r"></div><script type="module">const x=<Foo className="a"/>;</script>',
      widgetId: 'guard-test',
      themeVars: { '--bg': '#eee' },
    });
    assert.match(srcdoc, /__quoteCssVarsInJsx/);
    assert.match(srcdoc, /Quoted unquoted var/);
  });
});
