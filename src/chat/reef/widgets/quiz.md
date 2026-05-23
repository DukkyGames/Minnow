Multiple-choice quiz, one question at a time, with score and optional restart.

```reef-widget
<style>
.rw { max-width: 680px; font-family: var(--font-ui); color: var(--mn-fg); }
.rw h2 { margin: 0 0 8px; font-size: 1rem; font-weight: 500; }
.rw-progress { font-size: 0.8125rem; color: var(--mn-fg-muted); margin-bottom: 12px; font-weight: 400; }
.rw-q { font-size: 0.9375rem; font-weight: 500; margin-bottom: 12px; color: var(--mn-fg); }
.rw-opts { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.rw-opt {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border: 0.5px solid var(--mn-border); border-radius: var(--radius-md); background: var(--mn-surface-1); cursor: pointer;
}
.rw-opt:has(input:checked) { border-color: var(--mn-border-strong); background: var(--mn-surface-elevated); }
.rw-opt input { accent-color: var(--mn-accent); }
.rw-opt span { font-size: 0.875rem; font-weight: 400; color: var(--mn-fg); }
.rw-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.rw-actions button {
  padding: 8px 14px; border: 0.5px solid var(--mn-border-strong); border-radius: var(--radius-md);
  background: var(--mn-accent); color: var(--mn-fg); font-family: var(--font-ui); font-size: 0.875rem; font-weight: 500; cursor: pointer;
}
.rw-actions button.secondary {
  background: var(--mn-surface-1); border-color: var(--mn-border); color: var(--mn-fg-muted);
}
.rw-result { padding: 12px; border: 0.5px solid var(--mn-border); border-radius: var(--radius-md); background: var(--mn-surface-elevated); color: var(--mn-fg); }
.rw-result strong { color: var(--mn-accent); font-weight: 500; }
</style>
<div class="rw" id="quiz">
  <h2>Quick quiz</h2>
  <p class="rw-progress" id="progress">Question 1 of 4</p>
  <div id="body"></div>
</div>
<script>
(function () {
  var QUESTIONS = [
    {
      text: 'Which tag order does a Reef widget fence use?',
      choices: ['Script, style, markup', 'Style, markup, script', 'Markup, script, style'],
      correct: 1,
    },
    {
      text: 'Where should chart resize be requested after layout?',
      choices: ['window.minnow.sendPrompt', 'window.minnow.requestResize', 'document.reload'],
      correct: 1,
    },
    {
      text: 'Which bridge API streams tokens inside a widget iframe?',
      choices: ['sendPrompt', 'callLLM', 'openLink'],
      correct: 1,
    },
    {
      text: 'Reef widgets mount only when the active chat mode is:',
      choices: ['Build', 'Plan', 'Reef'],
      correct: 2,
    },
  ];

  var index = 0;
  var answers = [];
  var phase = 'quiz';
  var progress = document.getElementById('progress');
  var body = document.getElementById('body');

  function renderQuiz() {
    var q = QUESTIONS[index];
    progress.textContent = 'Question ' + (index + 1) + ' of ' + QUESTIONS.length;
    var opts = q.choices.map(function (c, i) {
      var checked = answers[index] === i ? ' checked' : '';
      return (
        '<label class="rw-opt">' +
        '<input type="radio" name="q" value="' + i + '"' + checked + ' />' +
        '<span>' + c + '</span></label>'
      );
    }).join('');
    var nextLabel = index < QUESTIONS.length - 1 ? 'Next' : 'Finish';
    body.innerHTML =
      '<p class="rw-q">' + q.text + '</p>' +
      '<div class="rw-opts">' + opts + '</div>' +
      '<div class="rw-actions"><button type="button" id="nextBtn">' + nextLabel + '</button></div>';

    body.querySelectorAll('input[name="q"]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        answers[index] = +inp.value;
      });
    });
    document.getElementById('nextBtn').addEventListener('click', onNext);
  }

  function score() {
    var n = 0;
    for (var i = 0; i < QUESTIONS.length; i++) {
      if (answers[i] === QUESTIONS[i].correct) n++;
    }
    return n;
  }

  function renderResult() {
    var s = score();
    progress.textContent = 'Results';
    body.innerHTML =
      '<div class="rw-result" aria-live="polite">' +
      'You scored <strong>' + s + ' / ' + QUESTIONS.length + '</strong>.' +
      (s === QUESTIONS.length ? ' Perfect!' : ' Review the Reef widget conventions and try again.') +
      '</div>' +
      '<div class="rw-actions" style="margin-top:12px">' +
      '<button type="button" id="restartBtn" class="secondary">Restart</button></div>';
    document.getElementById('restartBtn').addEventListener('click', function () {
      index = 0;
      answers = [];
      phase = 'quiz';
      renderQuiz();
    });
  }

  function onNext() {
    if (answers[index] == null) return;
    if (index < QUESTIONS.length - 1) {
      index++;
      renderQuiz();
      return;
    }
    phase = 'result';
    renderResult();
  }

  renderQuiz();
})();
</script>
```
