/**
 * LSP readiness predicates for capability-matrix probes.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { lspServersUsable } from '../../src/benchmark/capabilities/probe-lsp-ready.ts';

describe('lspServersUsable', () => {
  test('running non-disabled server is usable', () => {
    assert.equal(
      lspServersUsable([
        {
          id: 'ts',
          label: 'TypeScript',
          disabled: false,
          running: true,
          extensions: ['ts'],
          builtin: true,
          hasCommand: true,
        },
      ]),
      true,
    );
  });

  test('disabled server is not usable even when running', () => {
    assert.equal(
      lspServersUsable([
        {
          id: 'ts',
          label: 'TypeScript',
          disabled: true,
          running: true,
          extensions: ['ts'],
          builtin: true,
          hasCommand: true,
        },
      ]),
      false,
    );
  });

  test('stopped server with launch command is usable', () => {
    assert.equal(
      lspServersUsable([
        {
          id: 'ts',
          label: 'TypeScript',
          disabled: false,
          running: false,
          extensions: ['ts'],
          builtin: true,
          hasCommand: true,
        },
      ]),
      true,
    );
  });

  test('stopped server without command is not usable', () => {
    assert.equal(
      lspServersUsable([
        {
          id: 'ts',
          label: 'TypeScript',
          disabled: false,
          running: false,
          extensions: ['ts'],
          builtin: true,
          hasCommand: false,
        },
      ]),
      false,
    );
  });
});
