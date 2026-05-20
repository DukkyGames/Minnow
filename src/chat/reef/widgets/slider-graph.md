Range slider drives a live line chart. React variant using `recharts` from the host import map.

```reef-widget
<style>
.rw { max-width: 680px; min-width: 0; font-family: var(--font-ui); color: var(--text); }
.rw-chart { height: 220px; min-height: 220px; min-width: 0; width: 100%; border: 0.5px solid var(--border); border-radius: var(--radius-md); background: var(--surface); }
</style>
<div id="root"></div>
<script type="module">
import React, { useLayoutEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

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
          <LineChart data={data} margin={{ top: 12, right: 12, bottom: 8, left: 32 }}>
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
