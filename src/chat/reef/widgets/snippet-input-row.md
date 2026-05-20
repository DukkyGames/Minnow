One labeled field with inline `.err` hint. Validation skeleton from `form.md` — no submit button.

- Swap `id` / `for` and the regex rule in `validate()`.
- Call `validate()` on `blur` and `input` after the first failed attempt.

```reef-widget
<style>
.rw { max-width: 680px; font-family: var(--font-ui); color: var(--text); }
.rw label { display: block; font-weight: 500; margin-bottom: 4px; font-size: 0.875rem; }
.rw input {
  width: 100%; padding: 8px 10px; border: 0.5px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--text); font-family: var(--font-ui); font-size: 0.875rem;
  box-sizing: border-box;
}
.rw .err { margin-top: 4px; color: var(--danger, var(--text)); font-size: 0.75rem; min-height: 1rem; }
</style>
<div class="rw">
  <label for="email">Email</label>
  <input id="email" type="email" placeholder="you@example.com" autocomplete="email" />
  <div id="emailErr" class="err" role="alert"></div>
</div>
<script>
(function () {
  var field = document.getElementById('email');
  var err = document.getElementById('emailErr');
  var touched = false;
  function validate() {
    var v = field.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
      err.textContent = 'Enter a valid email address.';
      return false;
    }
    err.textContent = '';
    return true;
  }
  field.addEventListener('blur', function () {
    touched = true;
    validate();
  });
  field.addEventListener('input', function () {
    if (touched) validate();
  });
})();
</script>
```
