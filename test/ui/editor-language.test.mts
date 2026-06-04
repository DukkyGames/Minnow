import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  resolveLanguageDescription,
  resolveLanguageDescriptionByName,
} from '../../src/ui/editor-language.ts';

describe('editor language resolver', () => {
  test('matchFilename resolves TypeScript from path', () => {
    const desc = resolveLanguageDescription('src/components/App.tsx');
    assert.ok(desc);
    assert.match(desc.name, /TypeScript|TSX/i);
  });

  test('matchFilename resolves Python from .py', () => {
    const desc = resolveLanguageDescription('scripts/run.py');
    assert.ok(desc);
    assert.match(desc.name, /Python/i);
  });

  test('unknown extension returns null', () => {
    assert.equal(resolveLanguageDescription('notes.xyzunknown'), null);
  });

  test('matchLanguageName resolves Markdown', () => {
    const desc = resolveLanguageDescriptionByName('Markdown');
    assert.ok(desc);
    assert.match(desc.name, /Markdown/i);
  });

  test('empty language name returns null', () => {
    assert.equal(resolveLanguageDescriptionByName('   '), null);
  });
});
