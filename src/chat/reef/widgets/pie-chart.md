Donut chart with legend and sliders to adjust 4 slice values. React + Recharts from the host import map.

```reef-widget
<style>
.rw { max-width: 680px; min-width: 0; font-family: var(--font-ui); color: var(--mn-fg); }
.rw h2 { margin: 0 0 12px; font-size: 1rem; font-weight: 500; }
.rw-sliders { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
.rw-sliders label { display: flex; flex-direction: column; gap: 4px; font-size: 0.8125rem; font-weight: 400; color: var(--mn-fg-muted); min-width: 0; }
.rw-sliders input[type="range"] { width: 100%; accent-color: var(--mn-accent); }
.rw-sliders .rw-val { font-family: var(--font-mono); font-size: 0.75rem; color: var(--mn-fg); }
.rw-chart {
  height: 240px; min-height: 240px; min-width: 0; width: 100%;
  border: 0.5px solid var(--mn-border); border-radius: var(--radius-md); background: var(--mn-surface-1);
}
</style>
<div id="root"></div>
<script type="module">
import React, { useLayoutEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const SLICE_COLORS = [
  'var(--mn-accent)',
  'color-mix(in srgb, var(--mn-accent) 65%, var(--mn-fg-muted))',
  'color-mix(in srgb, var(--mn-accent) 40%, var(--mn-surface-elevated))',
  'var(--mn-fg-muted)',
];
const LABELS = ['Alpha', 'Beta', 'Gamma', 'Delta'];

function App() {
  const [v0, setV0] = useState(35);
  const [v1, setV1] = useState(25);
  const [v2, setV2] = useState(20);
  const [v3, setV3] = useState(20);
  const values = [v0, v1, v2, v3];
  const setters = [setV0, setV1, setV2, setV3];

  const data = useMemo(
    () =>
      LABELS.map((name, i) => ({
        name,
        value: Math.max(0, values[i]),
        fill: SLICE_COLORS[i % SLICE_COLORS.length],
      })),
    [v0, v1, v2, v3],
  );

  useLayoutEffect(() => {
    if (window.minnow?.requestResize) window.minnow.requestResize();
  }, [data]);

  return (
    <div className="rw">
      <h2>Slice mix</h2>
      <div className="rw-sliders">
        {LABELS.map((label, i) => (
          <label key={label}>
            {label}
            <input
              type="range"
              min={0}
              max={100}
              value={values[i]}
              onChange={(e) => setters[i](+e.target.value)}
            />
            <span className="rw-val">{values[i]}</span>
          </label>
        ))}
      </div>
      <div className="rw-chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="52%"
              outerRadius="78%"
              paddingAngle={2}
            >
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.fill} stroke="var(--mn-surface-1)" strokeWidth={1} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'var(--mn-surface-1)',
                border: '0.5px solid var(--mn-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--mn-fg)',
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: 'var(--mn-fg-muted)' }}
              formatter={(value) => <span style={{ color: 'var(--mn-fg-muted)' }}>{value}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
</script>
```
