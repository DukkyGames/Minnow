/**
 * Static reef-widget fence lint rules.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { lintReefWidgetFence } from '../../../src/chat/reef/widget-fence-lint.ts';

const VALID_CHART_SNIPPET = `<style>.rw-chart { height: 220px; }</style>
<div id="root"></div>
<script type="module">
import React, { useLayoutEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';
function formatYTick(v) { return typeof v === 'number' ? v.toFixed(5) : ''; }
function App() {
  useLayoutEffect(() => { window.minnow?.requestResize?.(); }, []);
  return React.createElement('div', { className: 'rw-chart' },
    React.createElement(ResponsiveContainer, { width: '100%', height: '100%' },
      React.createElement(LineChart, { data: [], margin: { top: 12, right: 12, bottom: 8, left: 36 } },
        React.createElement(YAxis, { type: 'number', width: 60, tickFormatter: formatYTick }),
      ),
    ),
  );
}
createRoot(document.getElementById('root')).render(React.createElement(App));
</script>`;

describe('widget-fence-lint', () => {
  test('accepts hardened chart snippet', () => {
    const result = lintReefWidgetFence(VALID_CHART_SNIPPET);
    assert.equal(result.errors.length, 0);
  });

  test('errors on toExponential', () => {
    const body = `${VALID_CHART_SNIPPET}\n// tick: (v) => v.toExponential(2)`;
    const result = lintReefWidgetFence(body);
    assert.ok(result.errors.some((e) => /toExponential/i.test(e)));
  });

  test('errors when Recharts lacks rw-chart wrapper', () => {
    const body = VALID_CHART_SNIPPET.replace('.rw-chart', '.chart-box');
    const result = lintReefWidgetFence(body);
    assert.ok(result.errors.some((e) => /rw-chart|mw-chart/i.test(e)));
  });

  test('errors on unquoted var in style object', () => {
    const body = '<div style={{ color: var(--mn-fg) }}></div>';
    const result = lintReefWidgetFence(body);
    assert.ok(result.errors.some((e) => /quote/i.test(e)));
  });

  test('warns on JSX root render', () => {
    const body = 'createRoot(el).render(<App />);';
    const result = lintReefWidgetFence(body);
    assert.ok(result.warnings.some((w) => /createElement\(App\)/i.test(w)));
  });
});
