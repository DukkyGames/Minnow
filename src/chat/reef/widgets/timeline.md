Vertical timeline with dot-and-line rail; active step highlighted with accent.

```reef-widget
<style>
.rw { max-width: 680px; font-family: var(--font-ui); color: var(--text); }
.rw h2 { margin: 0 0 12px; font-size: 1rem; font-weight: 500; }
.rw-tl { list-style: none; margin: 0; padding: 0; }
.rw-step { display: grid; grid-template-columns: 20px 1fr; gap: 12px; position: relative; padding-bottom: 20px; }
.rw-step:last-child { padding-bottom: 0; }
.rw-rail { display: flex; flex-direction: column; align-items: center; }
.rw-dot {
  width: 12px; height: 12px; border-radius: 50%; border: 0.5px solid var(--border-strong);
  background: var(--surface); flex-shrink: 0; z-index: 1;
}
.rw-step[data-active] .rw-dot { background: var(--accent); border-color: var(--accent); }
.rw-line {
  flex: 1; width: 0.5px; min-height: 24px; background: var(--border); margin-top: 4px;
}
.rw-step:last-child .rw-line { display: none; }
.rw-body { min-width: 0; padding-bottom: 2px; }
.rw-body h3 { margin: 0 0 4px; font-size: 0.875rem; font-weight: 500; color: var(--text); }
.rw-step[data-active] .rw-body h3 { color: var(--accent); }
.rw-body p { margin: 0 0 6px; font-size: 0.8125rem; font-weight: 400; color: var(--text); line-height: 1.45; }
.rw-date { font-size: 0.75rem; color: var(--text-muted); font-weight: 400; }
</style>
<div class="rw" id="timeline">
  <h2>Release timeline</h2>
  <ol class="rw-tl" id="tl"></ol>
</div>
<script>
(function () {
  var STEPS = [
    { title: 'Spec drafted', body: 'Reef widget library scope and conventions locked.', date: 'May 1', active: false },
    { title: 'Bridge shipped', body: 'sendPrompt, callLLM, and requestResize available in iframe prelude.', date: 'May 8', active: false },
    { title: 'Phase 1 templates', body: 'Eight vanilla and React widget markdown files added.', date: 'May 15', active: true },
    { title: 'Verification', body: 'Manual QA in Reef mode plus automated mount tests.', date: 'May 20', active: false },
    { title: 'Public docs', body: 'context.md and verification checklist updated.', date: 'May 22', active: false },
  ];
  var activeIdx = STEPS.findIndex(function (s) { return s.active; });
  if (activeIdx < 0) activeIdx = 0;

  document.getElementById('tl').innerHTML = STEPS.map(function (step, i) {
    var isActive = i === activeIdx;
    return (
      '<li class="rw-step"' + (isActive ? ' data-active' : '') + '>' +
      '<div class="rw-rail"><span class="rw-dot" aria-hidden="true"></span><span class="rw-line" aria-hidden="true"></span></div>' +
      '<div class="rw-body">' +
      '<h3>' + step.title + '</h3>' +
      '<p>' + step.body + '</p>' +
      '<time class="rw-date" datetime="' + step.date + '">' + step.date + '</time>' +
      '</div></li>'
    );
  }).join('');
})();
</script>
```
