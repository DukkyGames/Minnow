Tabbed panel demonstrating Reef streaming order: `<style>` first, markup second, `<script>` last.

```reef-widget
<style>
.rw { max-width: 680px; font-family: var(--font-ui); color: var(--text); }
.rw-tabs { display: flex; gap: 4px; border-bottom: 0.5px solid var(--border); margin-bottom: 12px; }
.rw-tab {
  padding: 8px 14px; border: none; background: transparent; color: var(--text-muted);
  font-family: var(--font-ui); font-size: 0.875rem; font-weight: 400; cursor: pointer;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}
.rw-tab[aria-selected="true"] { color: var(--text); background: var(--surface); border: 0.5px solid var(--border); border-bottom-color: var(--surface); margin-bottom: -0.5px; }
.rw-panel { display: none; padding: 12px; border: 0.5px solid var(--border); border-radius: var(--radius-md); background: var(--surface); }
.rw-panel[data-active] { display: block; }
.rw-panel code { font-family: var(--font-mono); font-size: 0.8125rem; color: var(--text-muted); }
</style>
<div class="rw" id="tabs">
  <div class="rw-tabs" role="tablist">
    <button type="button" class="rw-tab" role="tab" data-tab="style" aria-selected="true">Style</button>
    <button type="button" class="rw-tab" role="tab" data-tab="markup" aria-selected="false">Markup</button>
    <button type="button" class="rw-tab" role="tab" data-tab="script" aria-selected="false">Script</button>
  </div>
  <section class="rw-panel" role="tabpanel" data-tab="style" data-active>
    <p>Emit <code>&lt;style&gt;</code> first so tokens and layout appear while the fence streams.</p>
  </section>
  <section class="rw-panel" role="tabpanel" data-tab="markup">
    <p>Then visible HTML so structure is readable before behavior loads.</p>
  </section>
  <section class="rw-panel" role="tabpanel" data-tab="script">
    <p>Finish with <code>&lt;script&gt;</code> so interactivity mounts last.</p>
  </section>
</div>
<script>
(function () {
  const root = document.getElementById('tabs');
  const tabs = root.querySelectorAll('.rw-tab');
  const panels = root.querySelectorAll('.rw-panel');
  function select(id) {
    tabs.forEach((t) => t.setAttribute('aria-selected', t.dataset.tab === id ? 'true' : 'false'));
    panels.forEach((p) => { if (p.dataset.tab === id) p.setAttribute('data-active', ''); else p.removeAttribute('data-active'); });
  }
  tabs.forEach((t) => t.addEventListener('click', () => select(t.dataset.tab)));
})();
</script>
```
