# Form widget template

Validated inputs with inline error hints. Uses Minnow CSS variables only.

```reef-widget
<style>
.wrap { max-width: 680px; font-family: var(--font-ui); color: var(--mn-fg); }
label { display: block; font-weight: 500; margin-bottom: 4px; font-size: 14px; }
input { width: 100%; padding: 8px; border: 0.5px solid var(--mn-border); border-radius: var(--radius-sm); background: var(--mn-surface-1); color: var(--mn-fg); margin-bottom: 8px; }
.err { color: var(--mn-danger, var(--mn-fg)); font-size: 12px; min-height: 16px; }
button { padding: 8px 14px; border: 0.5px solid var(--mn-border-strong); border-radius: var(--radius-md); background: var(--mn-accent); color: var(--mn-fg-on-accent, var(--mn-fg)); font-weight: 500; cursor: pointer; }
</style>
<div class="wrap">
  <label for="email">Email</label>
  <input id="email" type="email" placeholder="you@example.com" />
  <div id="emailErr" class="err"></div>
  <button type="button" id="submit">Submit</button>
</div>
<script>
(function () {
  var email = document.getElementById('email');
  var err = document.getElementById('emailErr');
  document.getElementById('submit').addEventListener('click', function () {
    var v = email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
      err.textContent = 'Enter a valid email address.';
      return;
    }
    err.textContent = '';
    window.minnow.sendPrompt('Process form for ' + v);
  });
})();
</script>
```
