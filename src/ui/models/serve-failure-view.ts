/**
 * Failure copy for Local Server, inspector Load, and failed-load cards.
 * Title + cause + what to do — no grepped llama.cpp log as the headline.
 */

import type { ServeRecord } from '../../models/api-client';
import { el } from './dom';

/**
 * Title / remediation block. Full border + danger wash (no side stripe).
 * @returns null when there is nothing classified to show.
 */
export function serveFailureBlock(serve: ServeRecord): HTMLElement | null {
  const failure = serve.failure;
  const title =
    failure?.title ||
    serve.error ||
    (serve.status === 'crashed' ? 'Runtime crashed' : null);
  if (!title && !failure?.remediation) return null;

  const block = el('div', 'models-serve-failure');
  block.setAttribute('role', 'alert');
  block.appendChild(el('p', 'models-serve-failure__title', title || 'Load failed'));
  if (failure?.detail) {
    block.appendChild(el('p', 'models-serve-failure__detail', failure.detail));
  }
  if (failure?.remediation) {
    block.appendChild(el('p', 'models-serve-failure__fix', failure.remediation));
  }
  return block;
}
