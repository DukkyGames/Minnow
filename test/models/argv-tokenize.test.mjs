/**
 * POSIX-ish extra_args tokenizer. Hardcoded fixtures — a naive whitespace split
 * of `--chat-template "hello world"` is the bug this exists to fix.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  joinArgv,
  normalizeExtraArgs,
  quoteArgvToken,
  tokenizeArgv,
} from '../../src/models/argv-tokenize.mjs';

describe('tokenizeArgv', () => {
  test('splits on whitespace like a naive split for unquoted flags', () => {
    assert.deepEqual(tokenizeArgv('--no-mmap --flash-attn on'), [
      '--no-mmap',
      '--flash-attn',
      'on',
    ]);
  });

  test('keeps double-quoted values with spaces as one token', () => {
    assert.deepEqual(tokenizeArgv('--chat-template "hello world"'), [
      '--chat-template',
      'hello world',
    ]);
  });

  test('keeps single-quoted values with spaces as one token', () => {
    assert.deepEqual(tokenizeArgv("--chat-template 'hello world'"), [
      '--chat-template',
      'hello world',
    ]);
  });

  test('backslash escapes the next character outside single quotes', () => {
    assert.deepEqual(tokenizeArgv('--chat-template hello\\ world'), [
      '--chat-template',
      'hello world',
    ]);
  });

  test('backslash inside single quotes is literal', () => {
    assert.deepEqual(tokenizeArgv("--flag 'a\\b'"), ['--flag', 'a\\b']);
  });

  test('escaped quote inside double quotes', () => {
    assert.deepEqual(tokenizeArgv('--chat-template "say \\"hi\\""'), [
      '--chat-template',
      'say "hi"',
    ]);
  });

  test('empty and whitespace-only input yield no tokens', () => {
    assert.deepEqual(tokenizeArgv(''), []);
    assert.deepEqual(tokenizeArgv('   \t  '), []);
  });
});

describe('normalizeExtraArgs', () => {
  test('tokenizes a string extra_args blob', () => {
    assert.deepEqual(normalizeExtraArgs('--chat-template "hello world"'), [
      '--chat-template',
      'hello world',
    ]);
  });

  test('recovers a naive whitespace split of a quoted value', () => {
    // Inspector used to store raw.split(/\\s+/) of `--chat-template "hello world"`.
    assert.deepEqual(normalizeExtraArgs(['--chat-template', '"hello', 'world"']), [
      '--chat-template',
      'hello world',
    ]);
  });

  test('keeps an already-tokenized value that contains spaces', () => {
    assert.deepEqual(normalizeExtraArgs(['--chat-template', 'hello world']), [
      '--chat-template',
      'hello world',
    ]);
  });

  test('joinArgv quotes only tokens that contain whitespace', () => {
    assert.equal(joinArgv(['--chat-template', 'hello world']), '--chat-template "hello world"');
    assert.equal(quoteArgvToken('hello world'), '"hello world"');
    assert.equal(joinArgv(['--no-mmap']), '--no-mmap');
  });
});
