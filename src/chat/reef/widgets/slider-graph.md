Range slider drives a live line chart. React variant using `recharts` from the host import map.

```reef-widget
<style>
.rw { max-width: 680px; font-family: var(--font-ui); color: var(--text); }
.rw h2 { margin: 0 0 8px; font-size: 1rem; font-weight: 500; }
.rw-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.rw-row label { font-size: 0.8125rem; color: var(--text-muted); min-width: 72px; }
.rw-row input[type=range] { flex: 1; accent-color: var(--accent); }
.rw-val { font-family: var(--font-mono); font-size: 0.875rem; min-width: 2.5rem; text-align: right; }
.rw-chart { height: 200px; border: 0.5px solid var(--border); border-radius: var(--radius-md); background: var(--surface); }
</style>
<div id="root"></div>
<script type="module">
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

function App() {
  const [n, setN] = useState(6);
  const data = useMemo(() => {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push({ x: i, y: Math.round(20 + 15 * Math.sin(i * 0.7) + i * 4) });
    return pts;
  }, [n]);
  return (
    <div className="rw">
      <h2>Slider graph</h2>
      <div className="rw-row">
        <label htmlFor="pts">Points</label>
        <input id="pts" type="range" min="3" max="12" value={n} onChange={(e) => setN(+e.target.value)} />
        <span className="rw-val">{n}</span>
      </div>
      <div className="rw-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
            <XAxis dataKey="x" stroke="var(--text-muted)" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
            <YAxis stroke="var(--text-muted)" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)' }} />
            <Line type="monotone" dataKey="y" stroke="var(--accent)" strokeWidth={2} dot={{ fill: 'var(--accent)', r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')).render(React.createElement(App));
</script>
```
