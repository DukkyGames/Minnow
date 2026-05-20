Pure SVG sparkline (~80×24px, `stroke: var(--accent)`). No chart library.

**Embed in a stat card:** copy the `<svg class="rw-sparkline">` into the `.rw-spark` slot on `snippet-stat-card.md` (replace the placeholder). Keep the card’s `.rw-spark { margin-top: 8px; height: 36px; … }` wrapper so the line centers in the reserved band.

- Edit `POINTS` in the script to change the trend; polyline uses viewBox `0 0 80 24`.
- For multiple cards, duplicate the SVG per `.rw-spark` region.

```reef-widget
<style>
.rw { max-width: 680px; font-family: var(--font-ui); color: var(--text); }
.rw-sparkline { display: block; width: 80px; height: 24px; }
</style>
<div class="rw">
  <svg class="rw-sparkline" viewBox="0 0 80 24" width="80" height="24" aria-hidden="true">
    <polyline id="spark" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</div>
<script>
(function () {
  var values = [18, 16, 20, 14, 17, 12, 15, 10, 13, 8];
  var w = 80;
  var h = 24;
  var pad = 2;
  var max = Math.max.apply(null, values);
  var min = Math.min.apply(null, values);
  var span = max - min || 1;
  var step = (w - pad * 2) / (values.length - 1);
  var pts = values.map(function (v, i) {
    var x = pad + i * step;
    var y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  document.getElementById('spark').setAttribute('points', pts.join(' '));
})();
</script>
```
