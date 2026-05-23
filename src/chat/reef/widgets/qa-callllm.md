Ask a question via callLLM with streaming output; Send to chat fills the composer via sendPrompt (does not auto-send).

```reef-widget
<style>
.rw { max-width: 680px; font-family: var(--font-ui); color: var(--mn-fg); }
.rw h2 { margin: 0 0 12px; font-size: 1rem; font-weight: 500; }
.rw label { display: block; font-size: 0.8125rem; font-weight: 400; color: var(--mn-fg-muted); margin-bottom: 6px; }
.rw textarea {
  width: 100%; min-height: 72px; box-sizing: border-box; padding: 8px 10px;
  border: 0.5px solid var(--mn-border); border-radius: var(--radius-sm);
  background: var(--mn-surface-1); color: var(--mn-fg); font-family: var(--font-ui); font-size: 0.875rem; resize: vertical;
}
.rw-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.rw-actions button {
  padding: 8px 14px; border: 0.5px solid var(--mn-border-strong); border-radius: var(--radius-md);
  background: var(--mn-accent); color: var(--mn-fg); font-family: var(--font-ui); font-size: 0.875rem; font-weight: 500; cursor: pointer;
}
.rw-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.rw-actions button.secondary {
  background: var(--mn-surface-1); border-color: var(--mn-border); color: var(--mn-fg-muted);
}
.rw-out {
  margin-top: 12px; padding: 12px; min-height: 80px;
  border: 0.5px solid var(--mn-border); border-radius: var(--radius-md);
  background: var(--mn-surface-elevated); color: var(--mn-fg); font-size: 0.875rem; font-weight: 400;
  white-space: pre-wrap; word-break: break-word;
}
.rw-out.empty { color: var(--mn-fg-muted); }
.rw-err { margin-top: 8px; font-size: 0.75rem; color: var(--mn-fg-muted); min-height: 1em; }
</style>
<div class="rw" id="qa">
  <h2>Widget Q&amp;A</h2>
  <label for="q">Your question</label>
  <textarea id="q" placeholder="Ask something…"></textarea>
  <div class="rw-actions">
    <button type="button" id="ask">Ask</button>
    <button type="button" id="sendChat" class="secondary">Send to chat</button>
  </div>
  <div class="rw-out empty" id="out" aria-live="polite">Answer will stream here.</div>
  <p class="rw-err" id="err" role="alert"></p>
</div>
<script>
(function () {
  var q = document.getElementById('q');
  var out = document.getElementById('out');
  var err = document.getElementById('err');
  var askBtn = document.getElementById('ask');
  var sendBtn = document.getElementById('sendChat');
  var inflight = false;
  var lastAnswer = '';

  function resize() {
    if (window.minnow && typeof window.minnow.requestResize === 'function') {
      window.minnow.requestResize();
    }
  }

  function setOut(text, empty) {
    out.textContent = text;
    out.classList.toggle('empty', !!empty);
    resize();
  }

  askBtn.addEventListener('click', function () {
    if (inflight) return;
    var text = q.value.trim();
    if (!text) {
      err.textContent = 'Enter a question first.';
      return;
    }
    if (!window.minnow || typeof window.minnow.callLLM !== 'function') {
      err.textContent = 'callLLM bridge is not available.';
      return;
    }
    err.textContent = '';
    inflight = true;
    askBtn.disabled = true;
    lastAnswer = '';
    setOut('', false);

    window.minnow
      .callLLM({
        messages: [{ role: 'user', content: text }],
        onChunk: function (_delta, full) {
          lastAnswer = full;
          setOut(full, !full);
        },
      })
      .then(function (full) {
        lastAnswer = full;
        setOut(full || '(empty response)', !full);
      })
      .catch(function (e) {
        err.textContent = e && e.message ? e.message : 'LLM request failed.';
        setOut('Request failed.', false);
      })
      .finally(function () {
        inflight = false;
        askBtn.disabled = false;
        resize();
      });
  });

  sendBtn.addEventListener('click', function () {
    var payload = lastAnswer.trim() || q.value.trim();
    if (!payload) {
      err.textContent = 'Nothing to send yet.';
      return;
    }
    err.textContent = '';
    if (window.minnow && typeof window.minnow.sendPrompt === 'function') {
      window.minnow.sendPrompt(payload);
    }
  });
})();
</script>
```
