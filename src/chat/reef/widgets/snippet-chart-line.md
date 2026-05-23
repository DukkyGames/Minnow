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

function App() {
  const data = useMemo(() => DATA, []);
  useLayoutEffect(function () {
    if (window.minnow && typeof window.minnow.requestResize === 'function') {
      window.minnow.requestResize();
    }
  }, [data]);
  return (
    <div className="rw">
      <div className="rw-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 12, bottom: 8, left: 32 }}>
            <XAxis dataKey="x" stroke="var(--mn-fg-muted)" tick={{ fill: 'var(--mn-fg-muted)', fontSize: 11 }} />
            <YAxis stroke="var(--mn-fg-muted)" tick={{ fill: 'var(--mn-fg-muted)', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'var(--mn-surface-1)', border: '0.5px solid var(--mn-border)', borderRadius: 'var(--radius-sm)', color: 'var(--mn-fg)' }} />
            <Line type="monotone" dataKey="y" stroke="var(--mn-accent)" strokeWidth={2} dot={{ fill: 'var(--mn-accent)', r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')).render(React.createElement(App));
</script>
```
