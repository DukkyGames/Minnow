Single KPI card with optional delta caret. Styling aligned with `stats-dashboard.md`.

- Change `.rw-label` / `.rw-value` text; remove `.rw-delta` if you do not need a trend line.
- Toggle `.rw-delta.up` vs `.rw-delta.down` and caret `▲` / `▼` for direction.

```reef-widget
<style>
.rw { max-width: 680px; font-family: var(--font-ui); color: var(--mn-fg); }
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
</style>
<div class="rw">
  <div class="rw-card">
    <div class="rw-label">Active users</div>
    <div class="rw-value">12,480</div>
    <div class="rw-delta up"><span class="caret">▲</span> +8.2% vs last week</div>
  </div>
</div>
<script>
(function () {
  /* Static demo KPI; wire values from your data source as needed. */
})();
</script>
```
