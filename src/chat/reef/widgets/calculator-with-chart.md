Tip and bill-split calculator with a live bar chart (Subtotal, Tax, Tip, Total). React + `recharts` from the host import map. Use `className="rw-chart"` and `requestResize()` after layout.

```reef-widget
<style>
.rw { max-width: 680px; min-width: 0; font-family: var(--font-ui); color: var(--mn-fg); }
.rw h2 { margin: 0 0 12px; font-size: 1rem; font-weight: 500; }
.rw-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.rw label { display: flex; flex-direction: column; gap: 4px; font-size: 0.8125rem; font-weight: 400; color: var(--mn-fg-muted); min-width: 0; }
.rw input {
  padding: 8px 10px; border: 0.5px solid var(--mn-border); border-radius: var(--radius-sm);
  background: var(--mn-surface-1); color: var(--mn-fg); font-family: var(--font-mono); font-size: 0.875rem;
}
.rw-out {
  margin-top: 12px; padding: 12px; border: 0.5px solid var(--mn-border); border-radius: var(--radius-md);
  background: var(--mn-surface-elevated); color: var(--mn-fg); font-family: var(--font-mono); font-size: 0.875rem;
}
.rw-out strong { color: var(--mn-accent); font-weight: 500; }
.rw-chart {
  margin-top: 12px; height: 220px; min-height: 220px; min-width: 0; width: 100%;
  border: 0.5px solid var(--mn-border); border-radius: var(--radius-md); background: var(--mn-surface-1);
}
</style>
<div id="root"></div>
<script type="module">
import React, { useLayoutEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';

function App() {
  const [bill, setBill] = useState(48.5);
  const [tipPct, setTipPct] = useState(18);
  const [taxPct, setTaxPct] = useState(8.25);
  const [split, setSplit] = useState(2);

  const calc = useMemo(() => {
    const b = Math.max(0, bill);
    const taxAmt = b * (taxPct / 100);
    const tipAmt = (b + taxAmt) * (tipPct / 100);
    const total = b + taxAmt + tipAmt;
    return { taxAmt, tipAmt, total, each: total / Math.max(1, split) };
  }, [bill, tipPct, taxPct, split]);

  const barColors = [
    'var(--mn-accent)',
    'color-mix(in srgb, var(--mn-accent) 65%, var(--mn-fg-muted))',
    'color-mix(in srgb, var(--mn-accent) 40%, var(--mn-surface-elevated))',
    'var(--mn-fg-muted)',
  ];

  const data = useMemo(
    () => [
      { name: 'Subtotal', value: bill },
      { name: 'Tax', value: calc.taxAmt },
      { name: 'Tip', value: calc.tipAmt },
      { name: 'Total', value: calc.total },
    ],
    [bill, calc.taxAmt, calc.tipAmt, calc.total],
  );

  useLayoutEffect(() => {
    if (window.minnow?.requestResize) window.minnow.requestResize();
  }, [data, calc.each, split]);

  const fmt = (n) => '$' + (Number.isFinite(n) ? n.toFixed(2) : '0.00');

  function formatYTick(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(5) : '';
  }

  return (
    <div className="rw">
      <h2>Tip calculator</h2>
      <div className="rw-grid">
        <label>
          Bill amount
          <input
            type="number"
            min={0}
            step={0.5}
            value={bill}
            onChange={(e) => setBill(Math.max(0, +e.target.value || 0))}
          />
        </label>
        <label>
          Tip %
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={tipPct}
            onChange={(e) => setTipPct(Math.max(0, +e.target.value || 0))}
          />
        </label>
        <label>
          Tax %
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={taxPct}
            onChange={(e) => setTaxPct(Math.max(0, +e.target.value || 0))}
          />
        </label>
        <label>
          Split between
          <input
            type="number"
            min={1}
            max={20}
            step={1}
            value={split}
            onChange={(e) => setSplit(Math.max(1, Math.round(+e.target.value || 1)))}
          />
        </label>
      </div>
      <div className="rw-out" aria-live="polite">
        Subtotal: {fmt(bill)} · Tax: {fmt(calc.taxAmt)} · Tip: {fmt(calc.tipAmt)}
        <br />
        <strong>Total: {fmt(calc.total)}</strong> · Per person ({split}): <strong>{fmt(calc.each)}</strong>
      </div>
      <div className="rw-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 12, right: 12, bottom: 8, left: 36 }}>
            <XAxis dataKey="name" stroke="var(--mn-fg-muted)" tick={{ fill: 'var(--mn-fg-muted)', fontSize: 11 }} />
            <YAxis type="number" width={60} stroke="var(--mn-fg-muted)" tick={{ fill: 'var(--mn-fg-muted)', fontSize: 11 }} tickFormatter={formatYTick} />
            <Tooltip
              contentStyle={{
                background: 'var(--mn-surface-1)',
                border: '0.5px solid var(--mn-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--mn-fg)',
              }}
              formatter={(v) => fmt(Number(v))}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={barColors[i % barColors.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(React.createElement(App));
</script>
```
