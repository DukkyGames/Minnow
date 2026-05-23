Demo KPI grid (four cards); the latency card’s `.rw-spark` region is reserved for a future inline sparkline.

```reef-widget
<style>
.rw { max-width: 680px; font-family: var(--font-ui); color: var(--mn-fg); }
.rw h2 { margin: 0 0 12px; font-size: 1rem; font-weight: 500; }
.rw-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (min-width: 520px) { .rw-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.rw-card {
  padding: 12px; border: 0.5px solid var(--mn-border); border-radius: var(--radius-md);
  background: var(--mn-surface-1); min-width: 0;
}
.rw-card .rw-label { font-size: 0.75rem; font-weight: 400; color: var(--mn-fg-muted); margin-bottom: 6px; }
.rw-card .rw-value { font-size: 1.375rem; font-weight: 500; font-family: var(--font-mono); color: var(--mn-fg); line-height: 1.2; }
.rw-card .rw-delta {
  margin-top: 6px; font-size: 0.75rem; font-weight: 400; display: flex; align-items: center; gap: 4px;
}
.rw-delta.up { color: var(--mn-accent); }
.rw-delta.down { color: var(--mn-fg-muted); }
.rw-delta .caret { font-size: 0.625rem; }
.rw-spark {
  margin-top: 8px; height: 36px; border: 0.5px dashed var(--mn-border); border-radius: var(--radius-sm);
  background: var(--mn-surface-elevated); display: flex; align-items: center; justify-content: center;
  font-size: 0.625rem; color: var(--mn-fg-muted); font-weight: 400;
}
</style>
<div class="rw" id="stats">
  <h2>Stats dashboard</h2>
  <div class="rw-grid">
    <div class="rw-card">
      <div class="rw-label">Active users</div>
      <div class="rw-value">12,480</div>
      <div class="rw-delta up"><span class="caret">▲</span> +8.2% vs last week</div>
    </div>
    <div class="rw-card">
      <div class="rw-label">Revenue</div>
      <div class="rw-value">$84.2k</div>
      <div class="rw-delta up"><span class="caret">▲</span> +3.1% MoM</div>
    </div>
    <div class="rw-card">
      <div class="rw-label">Latency p95</div>
      <div class="rw-value">142 ms</div>
      <div class="rw-delta down"><span class="caret">▼</span> −12 ms</div>
      <div class="rw-spark" aria-hidden="true">Sparkline slot</div>
    </div>
    <div class="rw-card">
      <div class="rw-label">Error rate</div>
      <div class="rw-value">0.34%</div>
      <div class="rw-delta down"><span class="caret">▼</span> −0.08%</div>
    </div>
  </div>
</div>
<script>
(function () {
  /* Demo metrics are static; sparkline region is reserved for a future chart widget. */
})();
</script>
```
