/**
 * Hand off a completed compare column into a new Chat thread.
 */

import { humanizeModelSlug, slugFromModelId } from '../lib/format-model-label';
import { wrapUntrusted } from '../lib/untrusted.mjs';
import { isOsShellEnabled } from '../os/page-bridge';
import { createAndActivateChat, scheduleSaveSessions } from '../state/sessions';
import type { Message } from '../types';

/** One compare column eligible for chat handoff. */
export interface CompareColumnHandoff {
  label: string;
  text: string;
  providerId: string;
  modelId: string;
}

export interface CompareHandoffInput {
  prompt: string;
  columns: CompareColumnHandoff[];
  selectedIndex: number;
}

/** Build chat history that preserves the chosen response as the starting assistant turn. */
export function buildCompareChatHistory(input: CompareHandoffInput): Message[] {
  const selected = input.columns[input.selectedIndex];
  if (!selected) {
    throw new Error('Invalid compare column');
  }

  const responseText = selected.text.trim();
  if (!responseText) {
    throw new Error('No response text to continue');
  }

  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error('Compare prompt is required');
  }

  const otherColumns = input.columns.filter(
    (col, index) => index !== input.selectedIndex && col.text.trim(),
  );

  let userContent = prompt;
  if (otherColumns.length > 0) {
    const referenceBlock = otherColumns
      .map((col) => {
        const modelLabel = formatHandoffModelLabel(col.providerId, col.modelId);
        return `**Response ${col.label}** (${modelLabel}):\n${wrapUntrusted(col.text.trim(), {
          source: 'compare-response',
        })}`;
      })
      .join('\n\n');
    userContent +=
      '\n\n---\nOther model responses from the same blind comparison (for reference):\n\n' +
      referenceBlock;
  }

  return [
    { role: 'user', content: userContent },
    {
      role: 'assistant',
      content: wrapUntrusted(responseText, { source: 'compare-response' }),
    },
  ];
}

/** Short sidebar title for a compare spinoff chat. */
export function buildCompareChatName(selected: CompareColumnHandoff): string {
  const slug = slugFromModelId(selected.modelId);
  const name = humanizeModelSlug(slug);
  return `Compare · ${selected.label} · ${name}`;
}

function formatHandoffModelLabel(providerId: string, modelId: string): string {
  const slug = slugFromModelId(modelId);
  const name = humanizeModelSlug(slug);
  return `${name} (${providerId})`;
}

/** Create a chat seeded from a compare column and open the chat surface. */
export async function continueCompareInChat(input: CompareHandoffInput): Promise<void> {
  const selected = input.columns[input.selectedIndex];
  if (!selected?.providerId || !selected.modelId) {
    throw new Error('Model binding is required to continue in chat');
  }

  const history = buildCompareChatHistory(input);
  const chat = createAndActivateChat(selected.modelId);
  chat.providerId = selected.providerId;
  chat.modeId = 'general';
  chat.name = buildCompareChatName(selected);
  chat.history.push(...history);
  scheduleSaveSessions();

  if (isOsShellEnabled()) {
    const { launchApp } = await import('../os/router');
    launchApp('code', { chatId: chat.id });
    const { closeCompare } = await import('../ui/compare-page');
    closeCompare();
  } else {
    const { closeCompare } = await import('../ui/compare-page');
    const { renderChatFromHistory } = await import('../ui/messages');
    closeCompare();
    renderChatFromHistory(chat);
  }

  const { renderSidebar } = await import('../ui/sidebar');
  renderSidebar();
}
