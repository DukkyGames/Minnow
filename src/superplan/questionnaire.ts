/**
 * Super Plan intake questionnaire — dedicated mount screen before the pipeline runs.
 */

import type {
  SuperPlanQuestion,
  SuperPlanQuestionnaireAnswers,
} from './types';

export interface SuperPlanQuestionnaireMount {
  /** Remove listeners and clear the mount element. */
  destroy(): void;
}

export interface SuperPlanQuestionnaireCopy {
  title?: string;
  subtitle?: string;
  submitLabel?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function collectAnswers(
  root: HTMLElement,
  questions: SuperPlanQuestion[],
): SuperPlanQuestionnaireAnswers {
  const answers: SuperPlanQuestionnaireAnswers = {};

  for (const q of questions) {
    if (q.kind === 'text') {
      const input = root.querySelector<HTMLTextAreaElement>(`#sp-q-${q.id}`);
      const value = input?.value.trim() ?? '';
      if (value) {
        answers[q.id] = value;
      }
      continue;
    }

    if (q.kind === 'single') {
      const selected = root.querySelector<HTMLInputElement>(
        `input[name="sp-q-${q.id}"]:checked`,
      );
      if (selected?.value) {
        answers[q.id] = selected.value;
      }
      continue;
    }

    const checked = root.querySelectorAll<HTMLInputElement>(
      `input[name="sp-q-${q.id}"]:checked`,
    );
    const values = [...checked].map((el) => el.value).filter(Boolean);
    if (values.length) {
      answers[q.id] = values;
    }
  }

  return answers;
}

function validateRequired(
  questions: SuperPlanQuestion[],
  answers: SuperPlanQuestionnaireAnswers,
): string | null {
  for (const q of questions) {
    const value = answers[q.id];
    if (q.kind === 'text') {
      if (typeof value !== 'string' || !value.trim()) {
        return `Please answer: ${q.prompt}`;
      }
      continue;
    }
    if (!value || (Array.isArray(value) && value.length === 0)) {
      return `Please answer: ${q.prompt}`;
    }
  }
  return null;
}

function renderQuestion(q: SuperPlanQuestion): string {
  if (q.kind === 'text') {
    return `
      <label class="sp-q-label" for="sp-q-${escapeHtml(q.id)}">${escapeHtml(q.prompt)}</label>
      <textarea
        id="sp-q-${escapeHtml(q.id)}"
        class="sp-q-text"
        rows="3"
        data-question-id="${escapeHtml(q.id)}"
      ></textarea>
    `;
  }

  const inputType = q.kind === 'single' ? 'radio' : 'checkbox';
  const options = (q.options ?? []).map((opt, i) => {
    const id = `sp-q-${q.id}-${i}`;
    return `
      <label class="sp-q-option" for="${escapeHtml(id)}">
        <input
          type="${inputType}"
          id="${escapeHtml(id)}"
          name="sp-q-${escapeHtml(q.id)}"
          value="${escapeHtml(opt)}"
        />
        <span>${escapeHtml(opt)}</span>
      </label>
    `;
  });

  return `
    <fieldset class="sp-q-fieldset" data-question-id="${escapeHtml(q.id)}">
      <legend class="sp-q-label">${escapeHtml(q.prompt)}</legend>
      <div class="sp-q-options">${options.join('')}</div>
    </fieldset>
  `;
}

/**
 * Render the intake questionnaire into `mount` and return answers via `onSubmit`.
 */
export function mountSuperPlanQuestionnaire(
  mount: HTMLElement,
  questions: SuperPlanQuestion[],
  onSubmit: (answers: SuperPlanQuestionnaireAnswers) => void,
  onCancel?: () => void,
  copy?: SuperPlanQuestionnaireCopy,
): SuperPlanQuestionnaireMount {
  const root = document.createElement('div');
  root.className = 'sp-questionnaire';

  const errorEl = document.createElement('p');
  errorEl.className = 'sp-q-error sp-mono';
  errorEl.hidden = true;
  errorEl.setAttribute('role', 'alert');

  const title = copy?.title ?? 'Plan intake';
  const subtitle =
    copy?.subtitle ?? 'Answer a few questions so we can shape your Super Plan.';
  const submitLabel = copy?.submitLabel ?? 'Continue';

  const form = document.createElement('form');
  form.className = 'sp-q-form';
  form.noValidate = true;
  form.innerHTML = `
    <header class="sp-q-head">
      <h2 class="sp-q-title">${escapeHtml(title)}</h2>
      <p class="sp-q-sub">${escapeHtml(subtitle)}</p>
    </header>
    <div class="sp-q-fields">
      ${questions.map((q) => `<div class="sp-q-block">${renderQuestion(q)}</div>`).join('')}
    </div>
    <footer class="sp-q-actions">
      ${onCancel ? '<button type="button" class="sp-btn sp-btn-ghost" data-sp-cancel>Cancel</button>' : ''}
      <button type="submit" class="sp-btn sp-btn-primary">${escapeHtml(submitLabel)}</button>
    </footer>
  `;

  root.append(errorEl, form);
  mount.replaceChildren(root);

  const showError = (msg: string): void => {
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
  };

  const onFormSubmit = (event: Event): void => {
    event.preventDefault();
    const answers = collectAnswers(root, questions);
    const validationError = validateRequired(questions, answers);
    if (validationError) {
      showError(validationError);
      return;
    }
    showError('');
    onSubmit(answers);
  };

  const onCancelClick = (): void => {
    onCancel?.();
  };

  form.addEventListener('submit', onFormSubmit);
  form.querySelector('[data-sp-cancel]')?.addEventListener('click', onCancelClick);

  return {
    destroy(): void {
      form.removeEventListener('submit', onFormSubmit);
      form.querySelector('[data-sp-cancel]')?.removeEventListener('click', onCancelClick);
      mount.replaceChildren();
    },
  };
}
