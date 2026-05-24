Minimal bar chart inside `.rw-chart`. Same axis/tooltip/resize pattern as the line snippet; `BarChart` / `Bar` from Recharts.

- Replace `DATA` with `{ name, value }` rows (or change `dataKey`s).
- Set `fill` on `<Bar>` to `var(--mn-accent)` or per-row `fill` with `color-mix(in srgb, var(--mn-accent) …)` for multi-series palettes.

```reef-widget
<style>
.rw { max-width: 680px; min-width: 0; font-family: var(--font-ui); color: var(--mn-fg); }
.rw-chart { height: 220px; min-height: 220px; min-width: 0; width: 100%; border: 0.5px solid var(--mn-border); border-radius: var(--radius-md); background: var(--mn-surface-1); }
</style>
<div id="root"></div>
<script type="module">
import React, { useLayoutEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

const DATA = [
  { name: 'Alpha', value: 42 },
  { name: 'Beta', value: 28 },
  { name: 'Gamma', value: 36 },
  { name: 'Delta', value: 19 },
  { name: 'Epsilon', value: 31 },
];

function formatYTick(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(5) : '';
}

const chartMargin = { top: 12, right: 12, bottom: 8, left: 36 };
const axisStroke = 'var(--mn-fg-muted)';
const tickStyle = { fill: 'var(--mn-fg-muted)', fontSize: 11 };
const tooltipStyle = {
  background: 'var(--mn-surface-1)',
  border: '0.5px solid var(--mn-border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--mn-fg)',
};

function App() {
  const data = useMemo(() => DATA, []);
  useLayoutEffect(function () {
    if (window.minnow && typeof window.minnow.requestResize === 'function') {
      window.minnow.requestResize();
    }
  }, [data]);

  return React.createElement(
    'div',
    { className: 'rw' },
    React.createElement(
      'div',
      { className: 'rw-chart' },
      React.createElement(
        ResponsiveContainer,
        { width: '100%', height: '100%' },
        React.createElement(
          BarChart,
          { data: data, margin: chartMargin },
          React.createElement(XAxis, { dataKey: 'name', stroke: axisStroke, tick: tickStyle }),
          React.createElement(YAxis, {
            type: 'number',
            width: 60,
            stroke: axisStroke,
            tick: tickStyle,
            tickFormatter: formatYTick,
          }),
          React.createElement(Tooltip, { contentStyle: tooltipStyle }),
          React.createElement(Bar, {
            dataKey: 'value',
            fill: 'var(--mn-accent)',
            radius: [4, 4, 0, 0],
          }),
        ),
      ),
    ),
  );
}

createRoot(document.getElementById('root')).render(React.createElement(App));
</script>
```
