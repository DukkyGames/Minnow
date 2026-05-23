Basic tip and bill-split calculator with multiple numeric fields. Vanilla HTML and script; uses Minnow CSS variables only.

```reef-widget
<style>
.rw { max-width: 680px; font-family: var(--font-ui); color: var(--mn-fg); }
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
</style>
<div class="rw" id="calc">
  <h2>Tip calculator</h2>
  <div class="rw-grid">
    <label>Bill amount<input type="number" id="bill" min="0" step="0.01" value="48.50"></label>
    <label>Tip %<input type="number" id="tip" min="0" max="100" step="1" value="18"></label>
    <label>Tax %<input type="number" id="tax" min="0" max="100" step="0.5" value="8.25"></label>
    <label>Split between<input type="number" id="split" min="1" max="20" step="1" value="2"></label>
  </div>
  <div class="rw-out" id="out" aria-live="polite">Enter values to calculate.</div>
</div>
<script>
(function () {
  const bill = document.getElementById('bill');
  const tip = document.getElementById('tip');
  const tax = document.getElementById('tax');
  const split = document.getElementById('split');
  const out = document.getElementById('out');
  const fmt = (n) => '$' + (Number.isFinite(n) ? n.toFixed(2) : '0.00');
  function run() {
    const b = Math.max(0, parseFloat(bill.value) || 0);
    const t = Math.max(0, parseFloat(tip.value) || 0) / 100;
    const x = Math.max(0, parseFloat(tax.value) || 0) / 100;
    const n = Math.max(1, Math.round(parseFloat(split.value) || 1));
    const taxAmt = b * x;
    const tipAmt = (b + taxAmt) * t;
    const total = b + taxAmt + tipAmt;
    const each = total / n;
    out.innerHTML =
      'Subtotal: ' + fmt(b) + ' · Tax: ' + fmt(taxAmt) + ' · Tip: ' + fmt(tipAmt) +
      '<br><strong>Total: ' + fmt(total) + '</strong> · Per person (' + n + '): <strong>' + fmt(each) + '</strong>';
  }
  [bill, tip, tax, split].forEach((el) => el.addEventListener('input', run));
  run();
})();
</script>
```
