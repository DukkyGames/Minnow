/**
 * Serializes ask_question UI so only one question strip runs at a time.
 */

import { showQuestionCardsModal } from '../ui/question-cards-modal';
import type { QuestionCardsModalContext } from '../ui/question-cards-modal';
import type { AskQuestionArgs } from './ask-question-types';
import { stringifyAskQuestionResult } from './ask-question-types';

interface Queued {
  args: AskQuestionArgs;
  context: QuestionCardsModalContext;
  resolve: (content: string) => void;
}

const queue: Queued[] = [];
let draining = false;

/**
 * Shows the question strip (or queues behind an active one) and resolves with tool JSON content.
 */
export function enqueueAskQuestion(
  args: AskQuestionArgs,
  context: QuestionCardsModalContext = {},
): Promise<string> {
  return new Promise((resolve) => {
    queue.push({ args, context, resolve });
    void drainQueue();
  });
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  const next = queue.shift();
  if (!next) return;
  draining = true;
  try {
    const result = await showQuestionCardsModal(next.args, next.context);
    next.resolve(stringifyAskQuestionResult(result));
  } catch {
    next.resolve(stringifyAskQuestionResult({ status: 'cancelled', answers: [] }));
  } finally {
    draining = false;
    if (queue.length > 0) {
      void drainQueue();
    }
  }
}
