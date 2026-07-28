/**
 * Board header provider + model selects (per-board orchestration model).
 */

import { resolveBoardModelBinding } from '../chat/orchestrate/board-model-binding.ts';
import { setBoardModel } from '../state/orchestrate-board-actions.ts';
import type { Chat, ChatGroup } from '../types.ts';
import { fillModelSelect, fillProviderSelect } from './settings-model-binding.ts';

type BoardState = NonNullable<ChatGroup['orchestrateBoard']>;

/** Append provider + model dropdowns to board header controls. */
export async function wireBoardHeaderModelSelect(
  controls: HTMLElement,
  group: ChatGroup,
  board: BoardState,
  plannerChat: Chat,
  onChanged: () => void,
): Promise<void> {
  const wrap = document.createElement('div');
  wrap.className = 'board-header__model';
  wrap.title = 'Model for this board (planner and task chats)';

  const providerSelect = document.createElement('select');
  providerSelect.className = 'board-header__model-provider';
  providerSelect.setAttribute('aria-label', 'Board model provider');

  const modelSelect = document.createElement('select');
  modelSelect.className = 'board-header__model-select';
  modelSelect.setAttribute('aria-label', 'Board model');

  wrap.appendChild(providerSelect);
  wrap.appendChild(modelSelect);
  controls.insertBefore(wrap, controls.firstChild);

  const binding = resolveBoardModelBinding(plannerChat, board);
  await fillProviderSelect(providerSelect, binding.providerId, { includeEmptyOption: false });
  if (!providerSelect.value && providerSelect.options.length > 0) {
    providerSelect.selectedIndex = 0;
  }
  await fillModelSelect(modelSelect, providerSelect.value, binding.modelId, {
    includeEmptyOption: false,
  });

  const persist = (): void => {
    const providerId = providerSelect.value.trim();
    const modelId = modelSelect.value.trim();
    if (!providerId || !modelId) return;
    setBoardModel(group, providerId, modelId, plannerChat);
    onChanged();
  };

  providerSelect.addEventListener('change', () => {
    void fillModelSelect(modelSelect, providerSelect.value, '', {
      includeEmptyOption: false,
    }).then(persist);
  });
  modelSelect.addEventListener('change', persist);
}

/** Keep header model selects aligned after in-place board refresh. */
export function syncBoardHeaderModelSelect(
  root: HTMLElement,
  board: BoardState,
  plannerChat: Chat,
): void {
  const providerSelect = root.querySelector(
    '.board-header__model-provider',
  ) as HTMLSelectElement | null;
  const modelSelect = root.querySelector(
    '.board-header__model-select',
  ) as HTMLSelectElement | null;
  if (!providerSelect || !modelSelect) return;
  const binding = resolveBoardModelBinding(plannerChat, board);
  if (binding.providerId && providerSelect.value !== binding.providerId) {
    providerSelect.value = binding.providerId;
  }
  if (binding.modelId && modelSelect.value !== binding.modelId) {
    modelSelect.value = binding.modelId;
  }
}
