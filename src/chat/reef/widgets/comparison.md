Two-column metrics comparison for side-by-side options. Vanilla HTML and script.

```reef-widget
<style>
.rw { max-width: 680px; font-family: var(--font-ui); color: var(--text); }
.rw h2 { margin: 0 0 12px; font-size: 1rem; font-weight: 500; }
.rw-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.rw-col { border: 0.5px solid var(--border); border-radius: var(--radius-md); padding: 12px; background: var(--surface); }
.rw-col h3 { margin: 0 0 10px; font-size: 0.875rem; font-weight: 500; }
.rw-metric { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 0.5px solid var(--border); font-size: 0.8125rem; }
.rw-metric:last-child { border-bottom: none; }
.rw-metric span:first-child { color: var(--text-muted); }
.rw-metric strong { font-family: var(--font-mono); font-weight: 500; }
.rw-metric[data-win] strong { color: var(--accent); }
.rw-note { margin-top: 10px; font-size: 0.75rem; color: var(--text-muted); }
</style>
<div class="rw" id="cmp">
  <h2>Plan comparison</h2>
  <div class="rw-cols">
    <div class="rw-col"><h3>Starter</h3><div id="a"></div></div>
    <div class="rw-col"><h3>Pro</h3><div id="b"></div></div>
  </div>
  <p class="rw-note">Highlighted values win on lower-is-better metrics (price, latency).</p>
</div>
<script>
(function () {
  const plans = {
    a: { label: 'Starter', price: 12, seats: 3, latency: 120, storage: 10 },
    b: { label: 'Pro', price: 29, seats: 15, latency: 45, storage: 100 },
  };
  const metrics = [
    { key: 'price', label: 'Price / mo', fmt: (v) => '$' + v, better: 'low' },
    { key: 'seats', label: 'Seats', fmt: (v) => String(v), better: 'high' },
    { key: 'latency', label: 'P95 ms', fmt: (v) => v + ' ms', better: 'low' },
    { key: 'storage', label: 'Storage GB', fmt: (v) => v + ' GB', better: 'high' },
  ];
  function render(id, plan) {
    const el = document.getElementById(id);
    el.innerHTML = metrics.map((m) => {
      const other = plan === plans.a ? plans.b : plans.a;
      const win = m.better === 'low' ? plan[m.key] < other[m.key] : plan[m.key] > other[m.key];
      return '<div class="rw-metric"' + (win ? ' data-win' : '') + '><span>' + m.label + '</span><strong>' + m.fmt(plan[m.key]) + '</strong></div>';
    }).join('');
  }
  render('a', plans.a);
  render('b', plans.b);
})();
</script>
```
