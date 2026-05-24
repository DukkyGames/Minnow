Minimal line chart inside `.rw-chart`. Recharts from the host import map.

- Replace `DATA` with your `{ x, y }` series (axis keys must match).
- Tune `margin` or chart height via `.rw-chart` in `<style>`.

```reef-widget
<style>
.rw { max-width: 680px; min-width: 0; font-family: var(--font-ui); color: var(--mn-fg); }
.rw-chart { height: 220px; min-height: 220px; min-width: 0; width: 100%; border: 0.5px solid var(--mn-border); border-radius: var(--radius-md); background: var(--mn-surface-1); }
</style>
<div id="root"></div>
<script type="module">
import React, { useLayoutEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

const DATA = [
  { x: 0, y: 24 },
  { x: 1, y: 31 },
  { x: 2, y: 28 },
  { x: 3, y: 36 },
  { x: 4, y: 33 },
  { x: 5, y: 42 },
  { x: 6, y: 38 },
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
          LineChart,
          { data: data, margin: chartMargin },
          React.createElement(XAxis, { dataKey: 'x', stroke: axisStroke, tick: tickStyle }),
          React.createElement(YAxis, {
            type: 'number',
            width: 60,
            stroke: axisStroke,
            tick: tickStyle,
            tickFormatter: formatYTick,
          }),
          React.createElement(Tooltip, { contentStyle: tooltipStyle }),
          React.createElement(Line, {
            type: 'monotone',
            dataKey: 'y',
            stroke: 'var(--mn-accent)',
            strokeWidth: 2,
            dot: { fill: 'var(--mn-accent)', r: 3 },
          }),
        ),
      ),
    ),
  );
}

createRoot(document.getElementById('root')).render(React.createElement(App));
</script>
```
