/**
 * Composer Expand — prompt construction and model-output sanitizing.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { buildExpandPromptMessages, sanitizeExpandedPrompt } = await import(
  '../../src/chat/prompts/expand-prompt.ts'
);

describe('buildExpandPromptMessages', () => {
  test('sends system rules plus the trimmed draft fenced in the user turn', () => {
    const messages = buildExpandPromptMessages('  add dark mode  ');
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.role, 'system');
    assert.equal(messages[1]?.role, 'user');
    assert.match(String(messages[1]?.content), /<draft>\nadd dark mode\n<\/draft>$/);
  });

  test('marks the draft as material, not an instruction to follow', () => {
    const user = String(buildExpandPromptMessages('fix the flaky test')[1]?.content);
    assert.match(user, /not an instruction to you/);
  });

  test('system prompt forbids answering the draft', () => {
    const system = String(buildExpandPromptMessages('x')[0]?.content ?? '');
    assert.match(system, /Do not answer, solve, plan, or begin the task\./);
  });

  test('caps very long drafts', () => {
    const messages = buildExpandPromptMessages('a'.repeat(20_000));
    assert.match(String(messages[1]?.content), /<draft>\na{8000}\n<\/draft>$/);
  });
});

describe('sanitizeExpandedPrompt', () => {
  test('returns plain output unchanged', () => {
    assert.equal(
      sanitizeExpandedPrompt('Add a dark mode toggle to the settings page.'),
      'Add a dark mode toggle to the settings page.',
    );
  });

  test('strips a "Here is the expanded prompt:" lead-in', () => {
    assert.equal(
      sanitizeExpandedPrompt("Here's the expanded prompt:\nAdd a dark mode toggle."),
      'Add a dark mode toggle.',
    );
    assert.equal(
      sanitizeExpandedPrompt('Expanded prompt: Add a dark mode toggle.'),
      'Add a dark mode toggle.',
    );
  });

  test('drops a completed thinking block and keeps the reply', () => {
    const raw = '<think>The user wants dark mode. I should…</think>\nAdd a dark mode toggle.';
    assert.equal(sanitizeExpandedPrompt(raw), 'Add a dark mode toggle.');
  });

  test('suppresses partials while a thinking block is still open', () => {
    const raw = '<think>The user wants dark mo';
    assert.equal(sanitizeExpandedPrompt(raw, { partial: true }), '');
  });

  test('emits the reply once the thinking block closes mid-stream', () => {
    const raw = '<think>reasoning</think>\nAdd a dark';
    assert.equal(sanitizeExpandedPrompt(raw, { partial: true }), 'Add a dark');
  });

  test('unwraps a fully fenced response', () => {
    const raw = '```\nAdd a dark mode toggle.\n```';
    assert.equal(sanitizeExpandedPrompt(raw), 'Add a dark mode toggle.');
  });

  test('unwraps a fully quoted response but leaves inner quotes alone', () => {
    assert.equal(sanitizeExpandedPrompt('"Add a dark mode toggle."'), 'Add a dark mode toggle.');
    assert.equal(
      sanitizeExpandedPrompt('Name the flag "darkMode" in settings.'),
      'Name the flag "darkMode" in settings.',
    );
  });

  test('returns empty for empty or thinking-only output', () => {
    assert.equal(sanitizeExpandedPrompt(''), '');
    assert.equal(sanitizeExpandedPrompt('   '), '');
  });
});
