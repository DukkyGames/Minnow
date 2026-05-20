Sortable table (click headers). Vanilla markup — lighter than `data-table.md`.

- Edit `rows` and `th[data-k]` keys to match your columns.
- Add a third sort key or drop a column by adjusting header/body cells together.

```reef-widget
<style>
.rw { max-width: 680px; font-family: var(--font-ui); color: var(--text); }
.rw table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.rw th, .rw td { padding: 8px 10px; border-bottom: 0.5px solid var(--border); text-align: left; }
.rw th { font-weight: 500; cursor: pointer; color: var(--text-muted); user-select: none; }
.rw th.sorted { color: var(--text); }
.rw td { font-weight: 400; }
</style>
<div class="rw">
  <table id="tbl">
    <thead>
      <tr>
        <th data-k="name">Name</th>
        <th data-k="role">Role</th>
        <th data-k="score">Score</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>
</div>
<script>
(function () {
  var rows = [
    { name: 'Ada', role: 'Eng', score: 92 },
    { name: 'Ben', role: 'Design', score: 78 },
    { name: 'Cy', role: 'PM', score: 85 },
    { name: 'Dee', role: 'Eng', score: 64 },
    { name: 'Eli', role: 'Ops', score: 71 },
  ];
  var key = 'name';
  var asc = true;
  function render() {
    rows.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (av < bv) return asc ? -1 : 1;
      if (av > bv) return asc ? 1 : -1;
      return 0;
    });
    var body = document.querySelector('#tbl tbody');
    body.innerHTML = rows
      .map(function (r) {
        return (
          '<tr><td>' +
          r.name +
          '</td><td>' +
          r.role +
          '</td><td>' +
          r.score +
          '</td></tr>'
        );
      })
      .join('');
  }
  document.querySelectorAll('#tbl th').forEach(function (th) {
    th.addEventListener('click', function () {
      if (key === th.dataset.k) asc = !asc;
      else {
        key = th.dataset.k;
        asc = true;
      }
      document.querySelectorAll('#tbl th').forEach(function (h) {
        h.classList.remove('sorted');
      });
      th.classList.add('sorted');
      render();
    });
  });
  document.querySelector('#tbl th[data-k="name"]').classList.add('sorted');
  render();
})();
</script>
```
