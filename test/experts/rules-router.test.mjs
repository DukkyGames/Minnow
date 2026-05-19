import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { registerExpertFilesFromRaw, resetExpertRegistry, listExperts } from '../../src/chat/experts/registry.ts';
import { routeExpertByRules } from '../../src/chat/experts/rules-router.ts';
import { loadExpertFixtureMap } from './test-helpers.mjs';

describe('rules router', () => {
  beforeEach(async () => {
    resetExpertRegistry();
    registerExpertFilesFromRaw(await loadExpertFixtureMap(), 'builtin');
  });

  function route(text) {
    return routeExpertByRules(text, listExperts(), { minScore: 3, autoOmitWhenNoMatch: false });
  }

  test('typescript bug → software-engineer', () => {
    const r = route('fix this TypeScript bug');
    assert.equal(r.expertId, 'software-engineer');
    assert.equal(r.source, 'rules');
  });

  test('poem → creative-writer', () => {
    const r = route('write a poem about rain');
    assert.equal(r.expertId, 'creative-writer');
    assert.equal(r.source, 'rules');
  });

  test('hello → general default', () => {
    const r = route('hello');
    assert.equal(r.expertId, 'general');
    assert.equal(r.source, 'default');
  });

  test('SELECT → data-analyst', () => {
    const r = route('SELECT * FROM users');
    assert.equal(r.expertId, 'data-analyst');
    assert.equal(r.source, 'rules');
  });

  test('typescript with negative avoids creative-writer', () => {
    const r = route('typescript poem hybrid');
    assert.notEqual(r.expertId, 'creative-writer');
  });
});
