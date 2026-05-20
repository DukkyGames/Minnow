# Data table widget template

Sortable table (click column headers). Vanilla HTML and script.

```reef-widget
<style>
.wrap { max-width: 680px; font-family: var(--font-ui); color: var(--text); }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 8px; border-bottom: 0.5px solid var(--border); text-align: left; }
th { font-weight: 500; cursor: pointer; color: var(--text-muted); }
th.sorted { color: var(--text); }
</style>
<div class="wrap">
  <table id="tbl">
    <thead><tr><th data-k="name">Name</th><th data-k="score">Score</th></tr></thead>
    <tbody></tbody>
  </table>
</div>
<script>
(function () {
  var rows = [{ name: 'Alpha', score: 12 }, { name: 'Beta', score: 30 }, { name: 'Gamma', score: 8 }];
  var key = 'name';
  var asc = true;
  function render() {
    rows.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (av < bv) return asc ? -1 : 1;
      if (av > bv) return asc ? 1 : -1;
      return 0;
    });
    var body = document.querySelector('#tbl tbody');
    body.innerHTML = rows.map(function (r) {
      return '<tr><td>' + r.name + '</td><td>' + r.score + '</td></tr>';
    }).join('');
  }
  document.querySelectorAll('#tbl th').forEach(function (th) {
    th.addEventListener('click', function () {
      key = th.dataset.k;
      asc = !asc;
      document.querySelectorAll('#tbl th').forEach(function (h) { h.classList.remove('sorted'); });
      th.classList.add('sorted');
      render();
    });
  });
  render();
})();
</script>
```
