Minimal bar chart inside `.rw-chart`. Same axis/tooltip/resize pattern as the line snippet; `BarChart` / `Bar` from Recharts.

- Replace `DATA` with `{ name, value }` rows (or change `dataKey`s).
- Set `fill` on `<Bar>` or per-row `fill` for multi-series palettes using actual colors (not theme tokens).

```reef-widget
<style>
.rw { max-width: 680px; min-width: 0; font-family: var(--font-ui); color: var(--text); }
.rw-chart { height: 220px; min-height: 220px; min-width: 0; width: 100%; border: 0.5px solid var(--border); border-radius: var(--radius-md); background: var(--surface); }
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
            <XAxis dataKey="name" stroke="var(--text-muted)" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
            <YAxis stroke="var(--text-muted)" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)' }} />
            <Bar dataKey="value" fill="#4f8ef7" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')).render(React.createElement(App));
</script>
```
