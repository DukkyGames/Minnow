/**
 * MIN-553 Phase 3 — three-state mode resolution, trailers, escalation flags (pure).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyAgentShellSandbox,
  formatPreferEscalationError,
  formatRequireSandboxError,
  formatSandboxTrailer,
  normalizeShellSandboxMode,
  resolveEffectiveShellSandboxMode,
  shouldApplyShellSandbox,
} from '../../../server/terminal/sandbox/index.js';
import { resolveOneShotSpawn } from '../../../server/terminal/one-shot-spawn.js';

const FAKE_WORKSPACE = '/Users/dev/Projects/app';

describe('Phase 3: shell sandbox mode resolution', () => {
  it('normalizes unknown values to fallback', () => {
    assert.equal(normalizeShellSandboxMode('prefer'), 'prefer');
    assert.equal(normalizeShellSandboxMode('nope', 'off'), 'off');
    assert.equal(normalizeShellSandboxMode(null, 'require'), 'require');
  });

  it('global chats default off; env elevates to prefer', () => {
    assert.equal(
      resolveEffectiveShellSandboxMode({
        globalMode: 'off',
        onBoard: false,
        env: {},
      }),
      'off',
    );
    assert.equal(
      resolveEffectiveShellSandboxMode({
        globalMode: 'off',
        onBoard: false,
        env: { MINNOW_SHELL_SANDBOX: '1' },
      }),
      'prefer',
    );
  });

  it('boards use global setting unless board override is set', () => {
    assert.equal(
      resolveEffectiveShellSandboxMode({
        globalMode: 'off',
        onBoard: true,
        env: {},
      }),
      'off',
    );
    assert.equal(
      resolveEffectiveShellSandboxMode({
        globalMode: 'prefer',
        onBoard: true,
        env: {},
      }),
      'prefer',
    );
    assert.equal(
      resolveEffectiveShellSandboxMode({
        globalMode: 'off',
        onBoard: true,
        boardMode: 'prefer',
        env: {},
      }),
      'prefer',
    );
  });

  it('clamps require to prefer on Windows', () => {
    assert.equal(
      resolveEffectiveShellSandboxMode({
        globalMode: 'require',
        onBoard: false,
        platform: 'win32',
        env: {},
      }),
      'prefer',
    );
    assert.equal(
      resolveEffectiveShellSandboxMode({
        globalMode: 'require',
        onBoard: false,
        platform: 'linux',
        env: {},
      }),
      'require',
    );
  });

  it('shouldApply respects mode and explicit overrides', () => {
    assert.equal(shouldApplyShellSandbox({ mode: 'off' }), false);
    assert.equal(shouldApplyShellSandbox({ mode: 'prefer' }), true);
    assert.equal(shouldApplyShellSandbox({ mode: 'require' }), true);
    assert.equal(shouldApplyShellSandbox({ mode: 'prefer', sandbox: false }), false);
    assert.equal(shouldApplyShellSandbox({ mode: 'off', sandbox: true }), true);
    assert.equal(shouldApplyShellSandbox({ source: 'user', mode: 'require' }), false);
  });
});

describe('Phase 3: unavailable escalation paths', () => {
  // Use an explicitly unsupported platform so these stay deterministic even when
  // the host has WSL2 + Landlock (win32 would otherwise apply successfully).
  const unsupported = 'aix';

  it('require on unsupported platform sets blocked', () => {
    const resolved = resolveOneShotSpawn({
      command: 'echo',
      args: ['hi'],
      shell: false,
      platform: unsupported,
    });
    const wrapped = applyAgentShellSandbox(resolved, {
      source: 'agent',
      mode: 'require',
      cwd: FAKE_WORKSPACE,
      workspaceRoot: FAKE_WORKSPACE,
      platform: unsupported,
    });
    assert.equal(wrapped.sandbox.applied, false);
    assert.equal(wrapped.sandbox.blocked, true);
    assert.equal(wrapped.sandbox.needsEscalation, undefined);
    assert.match(formatRequireSandboxError(wrapped.sandbox.detail), /required but unavailable/i);
  });

  it('prefer without allowUnsandboxed sets needsEscalation', () => {
    const resolved = resolveOneShotSpawn({
      command: 'echo',
      args: ['hi'],
      shell: false,
      platform: unsupported,
    });
    const wrapped = applyAgentShellSandbox(resolved, {
      source: 'agent',
      mode: 'prefer',
      allowUnsandboxed: false,
      cwd: FAKE_WORKSPACE,
      workspaceRoot: FAKE_WORKSPACE,
      platform: unsupported,
    });
    assert.equal(wrapped.sandbox.needsEscalation, true);
    assert.equal(wrapped.sandbox.blocked, undefined);
    assert.match(formatPreferEscalationError(wrapped.sandbox.detail), /Ask strip|unsandboxed/i);
  });

  it('prefer with allowUnsandboxed falls back without blocking', () => {
    const resolved = resolveOneShotSpawn({
      command: 'echo',
      args: ['hi'],
      shell: false,
      platform: unsupported,
    });
    const wrapped = applyAgentShellSandbox(resolved, {
      source: 'agent',
      mode: 'prefer',
      allowUnsandboxed: true,
      cwd: FAKE_WORKSPACE,
      workspaceRoot: FAKE_WORKSPACE,
      platform: unsupported,
    });
    assert.equal(wrapped.sandbox.applied, false);
    assert.equal(wrapped.sandbox.fallbackUnsandboxed, true);
    assert.equal(wrapped.sandbox.blocked, undefined);
    assert.equal(wrapped.sandbox.needsEscalation, undefined);
    assert.equal(wrapped.command, 'echo');
  });
});

describe('Phase 3: trailers', () => {
  it('formats sandboxed and NOT sandboxed trailers', () => {
    assert.equal(
      formatSandboxTrailer({
        applied: true,
        kind: 'seatbelt',
        profile: 'workspace',
        mode: 'prefer',
      }),
      '[sandboxed: seatbelt/workspace]',
    );
    assert.equal(
      formatSandboxTrailer({
        applied: false,
        mode: 'prefer',
        fallbackUnsandboxed: true,
        detail: 'platform_unsupported',
      }),
      '[NOT sandboxed: platform_unsupported]',
    );
    assert.equal(
      formatSandboxTrailer({
        applied: false,
        mode: 'off',
        reason: 'disabled',
      }),
      '',
    );
  });
});
