GitHub-style contribution calendar (7 day rows × 14 week columns) with hover counts.

```reef-widget
<style>
.rw { max-width: 680px; font-family: var(--font-ui); color: var(--text); }
.rw h2 { margin: 0 0 8px; font-size: 1rem; font-weight: 500; }
.rw-cap { font-size: 0.75rem; color: var(--text-muted); margin-bottom: 12px; font-weight: 400; }
.rw-heat-wrap { overflow-x: auto; padding-bottom: 4px; }
.rw-heat {
  display: grid; grid-template-rows: repeat(7, 12px); grid-auto-flow: column; gap: 3px;
  grid-auto-columns: 12px;
}
.rw-cell {
  width: 12px; height: 12px; border-radius: 2px; border: 0.5px solid var(--border);
  background: var(--surface); cursor: default;
}
.rw-cell[data-l="1"] { background: #93c5fd; }
.rw-cell[data-l="2"] { background: #60a5fa; }
.rw-cell[data-l="3"] { background: #3b82f6; }
.rw-cell[data-l="4"] { background: #1d4ed8; border-color: #1e40af; }
.rw-legend-row { display: flex; align-items: center; gap: 6px; margin-top: 10px; font-size: 0.75rem; color: var(--text-muted); }
.rw-legend-row .rw-heat { grid-auto-flow: row; grid-template-rows: none; grid-template-columns: repeat(5, 12px); gap: 3px; }
</style>
<div class="rw" id="heatmap">
  <h2>Activity heatmap</h2>
  <p class="rw-cap">Last 14 weeks · hover a cell for count</p>
  <div class="rw-heat-wrap">
    <div class="rw-heat" id="grid" role="img" aria-label="Contribution calendar"></div>
  </div>
  <div class="rw-legend-row">
    <span>Less</span>
    <div class="rw-heat" aria-hidden="true">
      <span class="rw-cell" data-l="0"></span>
      <span class="rw-cell" data-l="1"></span>
      <span class="rw-cell" data-l="2"></span>
      <span class="rw-cell" data-l="3"></span>
      <span class="rw-cell" data-l="4"></span>
    </div>
    <span>More</span>
  </div>
</div>
<script>
(function () {
  var weeks = 14;
  var days = 7;
  var grid = [
    [0,1,0,2,3,1,0,0,2,1,0,4,2,1],
    [1,2,1,0,1,2,3,1,0,2,3,1,0,2],
    [0,0,2,1,4,0,1,2,1,0,1,2,3,0],
    [2,1,0,3,1,2,0,1,3,2,1,0,1,3],
    [1,3,2,1,0,2,1,0,2,4,2,1,0,1],
    [0,1,1,2,2,0,3,2,1,1,0,3,2,0],
    [1,0,3,1,1,3,2,1,0,2,1,2,4,2],
  ];
  var max = 0;
  grid.forEach(function (row) {
    row.forEach(function (c) { if (c > max) max = c; });
  });
  var el = document.getElementById('grid');
  var html = '';
  for (var w = 0; w < weeks; w++) {
    for (var d = 0; d < days; d++) {
      var count = grid[d][w] || 0;
      var level = count === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4));
      html += '<span class="rw-cell" data-l="' + level + '" title="' + count + ' events"></span>';
    }
  }
  el.innerHTML = html;
})();
</script>
```
