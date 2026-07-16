/**
 * Fuzzy chat search core: token matching, ranking, snippets, draft exclusion.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { filterChatsByWorkspacePath, matchText, searchChats, tokenizeQuery } from '../../src/chat/chat-search.ts';
import type { Chat, Message } from '../../src/types.ts';

function makeChat(overrides: Partial<Chat> & { id: string }): Chat {
  return {
    name: 'Untitled',
    workspacePath: '/repo/minnow',
    modelId: 'test-model',
    modeId: 'general',
    workAgentId: null,
    workAgentAuto: true,
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1000,
    lastMessageAt: 1000,
    ...overrides,
  } as Chat;
}

function user(content: string): Message {
  return { role: 'user', content };
}

function assistant(content: string): Message {
  return { role: 'assistant', content };
}

describe('tokenizeQuery', () => {
  test('lowercases and splits on whitespace', () => {
    assert.deepEqual(tokenizeQuery('  Fix  LOGIN bug '), ['fix', 'login', 'bug']);
  });

  test('empty query yields no tokens', () => {
    assert.deepEqual(tokenizeQuery('   '), []);
  });
});

describe('matchText', () => {
  test('substring match scores higher at word starts', () => {
    const wordStart = matchText(['data'], 'the database schema');
    const midWord = matchText(['base'], 'the database schema');
    assert.ok(wordStart && midWord);
    assert.ok(wordStart.score > midWord.score);
  });

  test('fuzzy subsequence matches with gaps', () => {
    const hit = matchText(['dbase'], 'database');
    assert.ok(hit);
    const exact = matchText(['database'], 'database');
    assert.ok(exact && exact.score > hit.score);
  });

  test('all tokens must match (AND semantics)', () => {
    assert.equal(matchText(['login', 'zebra'], 'fix the login page'), null);
    assert.ok(matchText(['login', 'page'], 'fix the login page'));
  });

  test('subsequence with oversized gaps does not match', () => {
    assert.equal(matchText(['abc'], 'a' + 'x'.repeat(50) + 'bc'), null);
  });
});

describe('searchChats', () => {
  const chats: Chat[] = [
    makeChat({
      id: 'title-hit',
      name: 'Login page rework',
      history: [user('start with the header')],
      lastMessageAt: 3000,
    }),
    makeChat({
      id: 'message-hit',
      name: 'Tuesday sync',
      history: [
        user('can you fix the login form validation?'),
        assistant('Sure — the login form now validates email input.'),
      ],
      lastMessageAt: 2000,
    }),
    makeChat({
      id: 'unrelated',
      name: 'Recipe ideas',
      history: [user('pasta with garlic butter')],
    }),
    makeChat({ id: 'draft', name: 'New chat', history: [] }),
  ];

  test('empty query returns no results', () => {
    assert.deepEqual(searchChats(chats, ''), []);
  });

  test('finds keywords in titles and messages, ranking titles first', () => {
    const results = searchChats(chats, 'login');
    assert.deepEqual(
      results.map((r) => r.chat.id),
      ['title-hit', 'message-hit'],
    );
    assert.equal(results[0].matchedIn, 'title');
    assert.equal(results[1].matchedIn, 'message');
  });

  test('message hits carry a snippet around the match', () => {
    const results = searchChats(chats, 'validation');
    assert.equal(results.length, 1);
    assert.equal(results[0].chat.id, 'message-hit');
    assert.equal(results[0].role, 'user');
    assert.match(results[0].snippet, /login form validation/);
  });

  test('multi-word query needs every keyword in one text', () => {
    const results = searchChats(chats, 'garlic pasta');
    assert.deepEqual(
      results.map((r) => r.chat.id),
      ['unrelated'],
    );
    assert.deepEqual(searchChats(chats, 'garlic login'), []);
  });

  test('fuzzy query tolerates missing characters', () => {
    const results = searchChats(chats, 'valdation');
    assert.deepEqual(
      results.map((r) => r.chat.id),
      ['message-hit'],
    );
  });

  test('empty placeholder drafts are excluded', () => {
    assert.deepEqual(searchChats(chats, 'new chat'), []);
  });

  test('equal scores rank by recent activity', () => {
    const a = makeChat({
      id: 'older',
      name: 'alpha',
      history: [user('shared keyword here')],
      lastMessageAt: 100,
    });
    const b = makeChat({
      id: 'newer',
      name: 'beta',
      history: [user('shared keyword here')],
      lastMessageAt: 200,
    });
    const results = searchChats([a, b], 'shared keyword');
    assert.deepEqual(
      results.map((r) => r.chat.id),
      ['newer', 'older'],
    );
  });

  test('respects the result limit', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      makeChat({ id: `c${i}`, name: `deploy notes ${i}`, history: [user('hello')] }),
    );
    assert.equal(searchChats(many, 'deploy').length, 30);
    assert.equal(searchChats(many, 'deploy', { limit: 5 }).length, 5);
  });
});

describe('filterChatsByWorkspacePath', () => {
  test('keeps chats whose workspacePath matches after normalization', () => {
    const chats = [
      makeChat({ id: 'a', workspacePath: '/repo/minnow', history: [user('a')] }),
      makeChat({ id: 'b', workspacePath: '/repo/other', history: [user('b')] }),
      makeChat({ id: 'c', workspacePath: '', history: [user('c')] }),
    ];
    const filtered = filterChatsByWorkspacePath(chats, '/repo/minnow/');
    assert.deepEqual(
      filtered.map((chat) => chat.id),
      ['a'],
    );
  });

  test('returns all chats when workspace path is empty', () => {
    const chats = [
      makeChat({ id: 'a', workspacePath: '/repo/a', history: [user('a')] }),
      makeChat({ id: 'b', workspacePath: '/repo/b', history: [user('b')] }),
    ];
    assert.equal(filterChatsByWorkspacePath(chats, '').length, 2);
  });
});
