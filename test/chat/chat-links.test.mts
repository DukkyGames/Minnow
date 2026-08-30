/**
 * Durable chat links (MIN-630): normalize, pin, prompt block.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { addChatLink, formatChatLinksPromptBlock, removeChatLink } from '../../src/chat/links.ts';
import { composeSystemPrompt } from '../../src/chat/prompts/prompt-composer.ts';
import { normalizeChatRow, ensureChatLinks } from '../../src/state/session-schema.mjs';
import {
  createEmptyChatObject,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import type { ChatLink } from '../../src/types.ts';

const FILE_LINK: ChatLink = {
  id: '11111111-1111-1111-1111-111111111111',
  kind: 'file',
  path: 'src/main.ts',
  label: 'main.ts',
  addedAt: 1,
};

const URL_LINK: ChatLink = {
  id: '22222222-2222-2222-2222-222222222222',
  kind: 'url',
  url: 'https://example.com/docs',
  label: 'example.com',
  addedAt: 2,
};

describe('ensureChatLinks', () => {
  it('keeps valid file and URL links and drops junk', () => {
    const out = ensureChatLinks([
      FILE_LINK,
      URL_LINK,
      { id: 'x', kind: 'file', path: '.minnow/attachments/snap.txt', label: 'snap', addedAt: 3 },
      { id: 'y', kind: 'url', url: 'javascript:alert(1)', label: 'no', addedAt: 4 },
      { kind: 'file', path: 'src/foo.ts' },
    ]);
    assert.deepEqual(out, [FILE_LINK, URL_LINK]);
  });

  it('dedupes by path and URL, first wins', () => {
    const out = ensureChatLinks([
      FILE_LINK,
      { ...FILE_LINK, id: '33333333-3333-3333-3333-333333333333', label: 'other' },
      URL_LINK,
      { ...URL_LINK, id: '44444444-4444-4444-4444-444444444444' },
    ]);
    assert.deepEqual(out, [FILE_LINK, URL_LINK]);
  });
});

describe('normalizeChatRow links', () => {
  it('round-trips pinned links so reload still shows them', () => {
    const row = normalizeChatRow({
      id: 'chat-links-1',
      name: 'Linked',
      workspacePath: '/ws',
      modelId: '',
      history: [],
      updatedAt: 1,
      links: [FILE_LINK, URL_LINK],
    });
    assert.deepEqual(row.links, [FILE_LINK, URL_LINK]);
  });

  it('omits links when none survive sanitize', () => {
    const row = normalizeChatRow({
      id: 'chat-links-2',
      name: 'Empty',
      workspacePath: '/ws',
      modelId: '',
      history: [],
      updatedAt: 1,
      links: [{ id: 'z', kind: 'url', url: 'ftp://x', label: 'x', addedAt: 1 }],
    });
    assert.equal(row.links, undefined);
  });
});

describe('addChatLink / removeChatLink', () => {
  afterEach(() => {
    setSessionStateForTests(null);
  });

  it('pins a file and a URL, then removes the file', () => {
    const chat = createEmptyChatObject('');
    chat.id = 'chat-add-link';
    setSessionStateForTests({
      version: 6,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const file = addChatLink(chat, { kind: 'file', path: 'src/main.ts', label: 'main.ts' });
    const url = addChatLink(chat, {
      kind: 'url',
      url: 'https://example.com/docs',
      label: 'example.com',
    });
    assert.equal(file?.kind, 'file');
    assert.equal(file?.path, 'src/main.ts');
    assert.equal(url?.kind, 'url');
    assert.equal(url?.url, 'https://example.com/docs');
    assert.equal(chat.links?.length, 2);

    const dup = addChatLink(chat, { kind: 'file', path: 'src/main.ts' });
    assert.equal(dup?.id, file?.id);
    assert.equal(chat.links?.length, 2);

    assert.equal(removeChatLink(chat, file!.id), true);
    assert.equal(chat.links?.length, 1);
    assert.equal(chat.links?.[0]?.kind, 'url');
  });
});

describe('formatChatLinksPromptBlock', () => {
  it('lists standing files and URLs without dumping bodies', () => {
    const block = formatChatLinksPromptBlock([FILE_LINK, URL_LINK]);
    assert.equal(
      block,
      [
        'The user pinned these links on this chat. Treat them as standing context, not a one-turn attachment. Read files or open URLs when they are relevant:',
        '- file: src/main.ts',
        '- url: https://example.com/docs',
      ].join('\n'),
    );
  });

  it('composeSystemPrompt appends the block after other parts', () => {
    const out = composeSystemPrompt({
      profile: 'full',
      cwd: '/test',
      modeId: 'general',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      codeMapBlock: null,
      contextDocumentsBlock: null,
      enabledToolIds: [],
      infoPresetId: null,
      chatLinksBlock: formatChatLinksPromptBlock([FILE_LINK]) ?? undefined,
    });
    assert.match(out, /file: src\/main\.ts/);
  });
});
