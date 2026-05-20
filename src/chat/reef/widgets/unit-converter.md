Live unit converter with category tabs (length, weight, temperature), amount, and from/to selects.

```reef-widget
<style>
.rw { max-width: 680px; font-family: var(--font-ui); color: var(--text); }
.rw h2 { margin: 0 0 12px; font-size: 1rem; font-weight: 500; }
.rw-cats { display: flex; gap: 4px; border-bottom: 0.5px solid var(--border); margin-bottom: 12px; }
.rw-cat {
  padding: 8px 14px; border: none; background: transparent; color: var(--text-muted);
  font-family: var(--font-ui); font-size: 0.875rem; font-weight: 400; cursor: pointer;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}
.rw-cat[aria-selected="true"] {
  color: var(--text); background: var(--surface); border: 0.5px solid var(--border);
  border-bottom-color: var(--surface); margin-bottom: -0.5px;
}
.rw-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.rw label { display: flex; flex-direction: column; gap: 4px; font-size: 0.8125rem; font-weight: 400; color: var(--text-muted); min-width: 0; }
.rw input, .rw select {
  padding: 8px 10px; border: 0.5px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--text); font-family: var(--font-mono); font-size: 0.875rem;
}
.rw-out {
  margin-top: 12px; padding: 12px; border: 0.5px solid var(--border); border-radius: var(--radius-md);
  background: var(--surface-elevated); color: var(--text); font-family: var(--font-mono); font-size: 0.875rem;
}
.rw-out strong { color: var(--accent); font-weight: 500; }
</style>
<div class="rw" id="converter">
  <h2>Unit converter</h2>
  <div class="rw-cats" role="tablist" id="cats"></div>
  <div class="rw-grid">
    <label>Amount<input type="number" id="amt" min="0" step="any" value="1" /></label>
    <label>From<select id="from"></select></label>
    <label>To<select id="to"></select></label>
    <label style="visibility:hidden" aria-hidden="true">Spacer<select disabled></select></label>
  </div>
  <div class="rw-out" id="out" aria-live="polite">—</div>
</div>
<script>
(function () {
  var TABLES = {
    length: {
      units: { m: 1, km: 1000, ft: 0.3048, mi: 1609.344 },
      labels: { m: 'Meters', km: 'Kilometers', ft: 'Feet', mi: 'Miles' },
      defaultFrom: 'm',
      defaultTo: 'ft',
    },
    weight: {
      units: { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 },
      labels: { kg: 'Kilograms', g: 'Grams', lb: 'Pounds', oz: 'Ounces' },
      defaultFrom: 'kg',
      defaultTo: 'lb',
    },
    temperature: {
      units: { C: 'C', F: 'F', K: 'K' },
      labels: { C: 'Celsius', F: 'Fahrenheit', K: 'Kelvin' },
      defaultFrom: 'C',
      defaultTo: 'F',
    },
  };

  var category = 'length';
  var catsEl = document.getElementById('cats');
  var fromEl = document.getElementById('from');
  var toEl = document.getElementById('to');
  var amtEl = document.getElementById('amt');
  var outEl = document.getElementById('out');

  function tempConvert(value, from, to) {
    var c;
    if (from === 'C') c = value;
    else if (from === 'F') c = (value - 32) * (5 / 9);
    else c = value - 273.15;
    if (to === 'C') return c;
    if (to === 'F') return c * (9 / 5) + 32;
    return c + 273.15;
  }

  function fillSelect(sel, keys, labels) {
    sel.innerHTML = keys.map(function (k) {
      return '<option value="' + k + '">' + (labels[k] || k) + '</option>';
    }).join('');
  }

  function renderCats() {
    catsEl.innerHTML = Object.keys(TABLES).map(function (k) {
      return '<button type="button" class="rw-cat" role="tab" data-cat="' + k + '" aria-selected="' + (k === category ? 'true' : 'false') + '">' + k + '</button>';
    }).join('');
    catsEl.querySelectorAll('.rw-cat').forEach(function (btn) {
      btn.addEventListener('click', function () {
        category = btn.dataset.cat;
        catsEl.querySelectorAll('.rw-cat').forEach(function (b) {
          b.setAttribute('aria-selected', b.dataset.cat === category ? 'true' : 'false');
        });
        syncUnits();
        run();
      });
    });
  }

  function syncUnits() {
    var t = TABLES[category];
    var keys = Object.keys(t.units);
    fillSelect(fromEl, keys, t.labels);
    fillSelect(toEl, keys, t.labels);
    fromEl.value = t.defaultFrom;
    toEl.value = t.defaultTo;
  }

  function run() {
    var amount = parseFloat(amtEl.value);
    if (!Number.isFinite(amount)) {
      outEl.textContent = 'Enter a valid amount.';
      return;
    }
    var from = fromEl.value;
    var to = toEl.value;
    var t = TABLES[category];
    var result;
    if (category === 'temperature') {
      result = tempConvert(amount, from, to);
    } else {
      var base = amount * t.units[from];
      result = base / t.units[to];
    }
    var fmt = category === 'temperature' ? result.toFixed(2) : result.toPrecision(6).replace(/\.?0+$/, '');
    outEl.innerHTML =
      '<strong>' + fmt + '</strong> ' + (t.labels[to] || to) +
      ' <span style="color:var(--text-muted)">(' + amount + ' ' + (t.labels[from] || from) + ')</span>';
  }

  [amtEl, fromEl, toEl].forEach(function (el) {
    el.addEventListener('input', run);
    el.addEventListener('change', run);
  });

  renderCats();
  syncUnits();
  run();
})();
</script>
```
