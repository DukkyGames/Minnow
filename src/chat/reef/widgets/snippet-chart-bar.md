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
          <BarChart data={data} margin={{ top: 12, right: 12, bottom: 8, left: 32 }}>
            <XAxis dataKey="name" stroke="var(--mn-fg-muted)" tick={{ fill: 'var(--mn-fg-muted)', fontSize: 11 }} />
            <YAxis stroke="var(--mn-fg-muted)" tick={{ fill: 'var(--mn-fg-muted)', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'var(--mn-surface-1)', border: '0.5px solid var(--mn-border)', borderRadius: 'var(--radius-sm)', color: 'var(--mn-fg)' }} />
            <Bar dataKey="value" fill="var(--mn-accent)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')).render(React.createElement(App));
</script>
```
