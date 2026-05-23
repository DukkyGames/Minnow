Interactive checklist with add, toggle, remove, and a live completion footer.

```reef-widget
<style>
.rw { max-width: 680px; font-family: var(--font-ui); color: var(--mn-fg); }
.rw h2 { margin: 0 0 12px; font-size: 1rem; font-weight: 500; }
.rw-add { display: flex; gap: 8px; margin-bottom: 12px; }
.rw-add input {
  flex: 1; min-width: 0; padding: 8px 10px; border: 0.5px solid var(--mn-border); border-radius: var(--radius-sm);
  background: var(--mn-surface-1); color: var(--mn-fg); font-family: var(--font-ui); font-size: 0.875rem;
}
.rw-add button {
  padding: 8px 14px; border: 0.5px solid var(--mn-border-strong); border-radius: var(--radius-md);
  background: var(--mn-accent); color: var(--mn-fg); font-family: var(--font-ui); font-size: 0.875rem; font-weight: 500; cursor: pointer;
}
.rw-list { list-style: none; margin: 0; padding: 0; border: 0.5px solid var(--mn-border); border-radius: var(--radius-md); background: var(--mn-surface-1); }
.rw-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 0.5px solid var(--mn-border);
}
.rw-item:last-child { border-bottom: none; }
.rw-item input[type="checkbox"] { accent-color: var(--mn-accent); width: 16px; height: 16px; flex-shrink: 0; }
.rw-item label { flex: 1; min-width: 0; font-size: 0.875rem; font-weight: 400; cursor: pointer; }
.rw-item label.done { color: var(--mn-fg-muted); text-decoration: line-through; }
.rw-rm {
  padding: 4px 8px; border: 0.5px solid var(--mn-border); border-radius: var(--radius-sm);
  background: transparent; color: var(--mn-fg-muted); font-family: var(--font-ui); font-size: 0.75rem; font-weight: 400; cursor: pointer;
}
.rw-rm:hover { color: var(--mn-fg); border-color: var(--mn-border-strong); }
.rw-foot { margin-top: 10px; font-size: 0.8125rem; color: var(--mn-fg-muted); font-weight: 400; }
</style>
<div class="rw" id="checklist">
  <h2>Checklist</h2>
  <div class="rw-add">
    <input type="text" id="newItem" placeholder="Add a task…" aria-label="New task" />
    <button type="button" id="addBtn">Add</button>
  </div>
  <ul class="rw-list" id="list" aria-label="Tasks"></ul>
  <p class="rw-foot" id="foot" aria-live="polite">0 of 0 completed</p>
</div>
<script>
(function () {
  var items = [
    { id: '1', text: 'Review widget conventions', done: true },
    { id: '2', text: 'Ship Phase 1 templates', done: false },
    { id: '3', text: 'Run Reef verification', done: false },
  ];
  var nextId = 4;
  var list = document.getElementById('list');
  var foot = document.getElementById('foot');
  var input = document.getElementById('newItem');

  function updateFoot() {
    var done = items.filter(function (i) { return i.done; }).length;
    foot.textContent = done + ' of ' + items.length + ' completed';
  }

  function render() {
    list.innerHTML = items.map(function (item) {
      return (
        '<li class="rw-item" data-id="' + item.id + '">' +
        '<input type="checkbox" id="cb-' + item.id + '"' + (item.done ? ' checked' : '') + ' aria-label="Toggle ' + item.text.replace(/"/g, '&quot;') + '" />' +
        '<label for="cb-' + item.id + '" class="' + (item.done ? 'done' : '') + '">' + item.text + '</label>' +
        '<button type="button" class="rw-rm" data-rm="' + item.id + '" aria-label="Remove">Remove</button>' +
        '</li>'
      );
    }).join('');
    updateFoot();
  }

  list.addEventListener('change', function (e) {
    if (e.target.type !== 'checkbox') return;
    var row = e.target.closest('.rw-item');
    if (!row) return;
    var id = row.dataset.id;
    var item = items.find(function (i) { return i.id === id; });
    if (!item) return;
    item.done = e.target.checked;
    var lbl = row.querySelector('label');
    if (lbl) lbl.classList.toggle('done', item.done);
    updateFoot();
  });

  list.addEventListener('click', function (e) {
    var rm = e.target.closest('[data-rm]');
    if (!rm) return;
    var id = rm.getAttribute('data-rm');
    items = items.filter(function (i) { return i.id !== id; });
    render();
  });

  function addItem() {
    var text = input.value.trim();
    if (!text) return;
    items.push({ id: String(nextId++), text: text, done: false });
    input.value = '';
    render();
    input.focus();
  }

  document.getElementById('addBtn').addEventListener('click', addItem);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') addItem();
  });

  render();
})();
</script>
```
