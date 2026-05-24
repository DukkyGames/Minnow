Range slider drives a live line chart. React variant using `recharts` from the host import map.

```reef-widget
<style>
.rw { max-width: 680px; min-width: 0; font-family: var(--font-ui); color: var(--mn-fg); }
.rw-chart { height: 220px; min-height: 220px; min-width: 0; width: 100%; border: 0.5px solid var(--mn-border); border-radius: var(--radius-md); background: var(--mn-surface-1); }
</style>
<div id="root"></div>
<script type="module">
import React, { useLayoutEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

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
  const [n, setN] = useState(6);
  const data = useMemo(() => {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push({ x: i, y: Math.round(20 + 15 * Math.sin(i * 0.7) + i * 4) });
    return pts;
  }, [n]);
  useLayoutEffect(function () {
    if (window.minnow && typeof window.minnow.requestResize === 'function') {
      window.minnow.requestResize();
    }
  }, [n, data]);

  return React.createElement(
    'div',
    { className: 'rw' },
    React.createElement('h2', null, 'Slider graph'),
    React.createElement(
      'div',
      { className: 'rw-row' },
      React.createElement('label', { htmlFor: 'pts' }, 'Points'),
      React.createElement('input', {
        id: 'pts',
        type: 'range',
        min: 3,
        max: 12,
        value: n,
        onChange: (e) => setN(+e.target.value),
      }),
      React.createElement('span', { className: 'rw-val' }, String(n)),
    ),
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
