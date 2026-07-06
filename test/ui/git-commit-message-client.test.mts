import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { encodeModelSelectKey } from '../../src/lib/model-select-key.ts';
import { DEFAULT_EDITOR_AI_COMPLETION } from '../../src/config/editor-ai-completion.ts';
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';
import {
  buildGitCommitMessagePrompt,
  resolveCommitMessageDisplayText,
  resolveGitCommitMessageBinding,
  sanitizeCommitMessage,
  stripThinkingFromCommitOutput,
  truncateStagedPatch,
} from '../../src/ui/git-commit-message-client.ts';

describe('truncateStagedPatch', () => {
  test('returns patch unchanged when under limit', () => {
    const patch = 'diff --git a/foo.ts b/foo.ts\n+hello';
    assert.equal(truncateStagedPatch(patch, 100), patch);
  });

  test('appends truncation marker when over limit', () => {
    const patch = 'x'.repeat(120);
    const out = truncateStagedPatch(patch, 50);
    assert.ok(out.startsWith('x'.repeat(50)));
    assert.match(out, /diff truncated/);
  });
});

describe('buildGitCommitMessagePrompt', () => {
  test('includes changed file list and diff in user message', () => {
    const messages = buildGitCommitMessagePrompt(['src/a.ts', 'src/b.ts'], '+added line');
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[1].role, 'user');
    const user = String(messages[1].content);
    assert.match(user, /src\/a\.ts/);
    assert.match(user, /src\/b\.ts/);
    assert.match(user, /\+added line/);
  });
});

describe('sanitizeCommitMessage', () => {
  test('strips markdown fences', () => {
    assert.equal(
      sanitizeCommitMessage('```\nfeat: add widget\n```'),
      'feat: add widget',
    );
  });

  test('strips wrapping quotes and prefixes', () => {
    assert.equal(sanitizeCommitMessage('"feat: ship it"'), 'feat: ship it');
    assert.equal(sanitizeCommitMessage('Commit message: fix: bug'), 'fix: bug');
  });

  test('preserves multiline body', () => {
    const raw = 'feat: add panel\n\nExplain why this matters.';
    assert.equal(sanitizeCommitMessage(raw), raw);
  });
});

describe('stripThinkingFromCommitOutput', () => {
  test('returns reply after inline thinking tags', () => {
    const raw = '<thinking>analyze diff</thinking>feat: add widget';
    assert.equal(stripThinkingFromCommitOutput(raw), 'feat: add widget');
  });
});

describe('resolveCommitMessageDisplayText', () => {
  test('prefers content channel over reasoning', () => {
    assert.equal(
      resolveCommitMessageDisplayText('feat: from content', 'fix: from reasoning', {
        reasoningFallback: true,
      }),
      'feat: from content',
    );
  });

  test('falls back to reasoning when content is empty', () => {
    assert.equal(
      resolveCommitMessageDisplayText('', 'feat: ship panel', { reasoningFallback: true }),
      'feat: ship panel',
    );
  });

  test('extracts conventional commit line from reasoning analysis', () => {
    const reasoning =
      'The diff adds a new panel.\n\nfeat(ui): add git commit generator\n\nLooks good.';
    assert.equal(
      resolveCommitMessageDisplayText('', reasoning, { reasoningFallback: true }),
      'feat(ui): add git commit generator\n\nLooks good.',
    );
  });

  test('does not use reasoning while streaming', () => {
    assert.equal(
      resolveCommitMessageDisplayText('', 'feat: only in reasoning', {
        reasoningFallback: false,
      }),
      '',
    );
  });
});

describe('resolveGitCommitMessageBinding', () => {
  test('uses chat model when editor AI is disabled', async () => {
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const chat = createEmptyChatObject('');
    setSessionStateForTests({ chats: [chat], activeId: chat.id });

    const sel = document.createElement('select');
    sel.id = 'modelSelect';
    const opt = document.createElement('option');
    opt.value = encodeModelSelectKey('lm-studio-local', 'glm-5.2');
    sel.appendChild(opt);
    sel.value = opt.value;
    document.body.appendChild(sel);

    const binding = await resolveGitCommitMessageBinding({
      ...DEFAULT_EDITOR_AI_COMPLETION,
      enabled: false,
      useChatModel: false,
      providerId: 'opencodego',
      modelId: 'qwen3.6-plus',
    });

    assert.equal(binding.providerId, 'lm-studio-local');
    assert.equal(binding.modelId, 'glm-5.2');
  });
});
