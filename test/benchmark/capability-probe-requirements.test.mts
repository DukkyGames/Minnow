/**
 * Capability probe requirement gating (n-a when unmet).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CAPABILITY_CATALOG, getCapabilityById } from '../../src/benchmark/capabilities/catalog.ts';
import {
  PHASE_2D_EMIT_ONLY_CAPABILITY_IDS,
  PHASE_2E_CONDITIONAL_CAPABILITY_IDS,
  PHASE_2G_MODE_PROMPT_CAPABILITY_IDS,
  resolveCapabilityProbeSkip,
  isCapabilityProbeWaveEnabled,
} from '../../src/benchmark/capabilities/probe-requirements.ts';
import { PHASE_2C_WORKSPACE_CAPABILITY_IDS } from '../../src/benchmark/capabilities/fixtures-workspace.ts';

describe('resolveCapabilityProbeSkip', () => {
  test('manual rows always skip', async () => {
    const cap = CAPABILITY_CATALOG.find((c) => c.scoreMode === 'manual');
    assert.ok(cap);
    const reason = await resolveCapabilityProbeSkip(cap!, {
      ctx: {
        providerId: 'p',
        modelId: 'm',
        localServer: true,
        signal: new AbortController().signal,
      },
    });
    assert.ok(reason?.includes('manual') || reason);
  });

  test('workspace auto probe skips without tool server (not fail)', async () => {
    const cap = getCapabilityById('files-list-read');
    assert.ok(cap);
    const reason = await resolveCapabilityProbeSkip(cap!, {
      ctx: {
        providerId: 'p',
        modelId: 'm',
        localServer: false,
        signal: new AbortController().signal,
      },
    });
    assert.match(reason ?? '', /npm start|workspace/i);
  });

  test('phase 2c workspace probes are wave-enabled but still gate on workspace', async () => {
    for (const id of PHASE_2C_WORKSPACE_CAPABILITY_IDS) {
      const cap = getCapabilityById(id);
      assert.ok(cap);
      assert.equal(isCapabilityProbeWaveEnabled(cap!), true, id);
      const reason = await resolveCapabilityProbeSkip(cap!, {
        ctx: {
          providerId: 'p',
          modelId: 'm',
          localServer: false,
          signal: new AbortController().signal,
        },
      });
      assert.ok(reason, id);
    }
  });

  test('phase 2d emit-only probes are wave-enabled without tool server', async () => {
    for (const id of PHASE_2D_EMIT_ONLY_CAPABILITY_IDS) {
      const cap = getCapabilityById(id);
      assert.ok(cap);
      assert.equal(isCapabilityProbeWaveEnabled(cap!), true, id);
      const reason = await resolveCapabilityProbeSkip(cap!, {
        ctx: {
          providerId: 'p',
          modelId: 'm',
          localServer: false,
          signal: new AbortController().signal,
        },
      });
      assert.equal(reason, null, id);
    }
  });

  test('phase 2e conditional probes are wave-enabled', () => {
    for (const id of PHASE_2E_CONDITIONAL_CAPABILITY_IDS) {
      const cap = getCapabilityById(id);
      assert.ok(cap, id);
      assert.equal(isCapabilityProbeWaveEnabled(cap!), true, id);
    }
  });

  test('lsp-diagnostics skips without tool server', async () => {
    const cap = getCapabilityById('lsp-diagnostics');
    assert.ok(cap);
    const reason = await resolveCapabilityProbeSkip(cap!, {
      ctx: {
        providerId: 'p',
        modelId: 'm',
        localServer: false,
        signal: new AbortController().signal,
      },
    });
    assert.match(reason ?? '', /npm start|LSP/i);
  });

  test('lsp-diagnostics skips when LSP environment not ready', async () => {
    const cap = getCapabilityById('lsp-diagnostics');
    assert.ok(cap);
    const reason = await resolveCapabilityProbeSkip(cap!, {
      ctx: {
        providerId: 'p',
        modelId: 'm',
        localServer: true,
        signal: new AbortController().signal,
      },
      lspEnvironmentReady: false,
    });
    assert.match(reason ?? '', /LSP unavailable/i);
  });

  test('lsp-diagnostics runs when LSP environment ready override set', async () => {
    const cap = getCapabilityById('lsp-diagnostics');
    assert.ok(cap);
    const reason = await resolveCapabilityProbeSkip(cap!, {
      ctx: {
        providerId: 'p',
        modelId: 'm',
        localServer: true,
        signal: new AbortController().signal,
      },
      lspEnvironmentReady: true,
    });
    assert.equal(reason, null);
  });

  test('core-vision skips for non-vision model catalog row', async () => {
    const cap = getCapabilityById('core-vision');
    assert.ok(cap);
    const reason = await resolveCapabilityProbeSkip(cap!, {
      ctx: {
        providerId: 'p',
        modelId: 'text-only-model',
        localServer: true,
        signal: new AbortController().signal,
      },
      catalogModels: [
        {
          id: 'text-only-model',
          type: 'llm',
          capabilities: { vision: false, tools: null, streaming: null, grammar: null, reasoning: null, contextLength: null, loadState: null },
        },
      ],
    });
    assert.match(reason ?? '', /vision/i);
  });

  test('core-vision runs for vision catalog row when wave-enabled', async () => {
    const cap = getCapabilityById('core-vision');
    assert.ok(cap);
    const reason = await resolveCapabilityProbeSkip(cap!, {
      ctx: {
        providerId: 'p',
        modelId: 'vlm-1',
        localServer: true,
        signal: new AbortController().signal,
      },
      catalogModels: [{ id: 'vlm-1', type: 'vlm' }],
    });
    assert.equal(reason, null);
  });

  test('tool-server probe skips without local server', async () => {
    const cap = getCapabilityById('code-execute-command');
    assert.ok(cap);
    const reason = await resolveCapabilityProbeSkip(cap!, {
      ctx: {
        providerId: 'p',
        modelId: 'm',
        localServer: false,
        signal: new AbortController().signal,
      },
    });
    assert.match(reason ?? '', /npm start/i);
  });

  test('git-fixture probe skips when fixture not seeded', async () => {
    const cap = getCapabilityById('core-tool-loop');
    assert.ok(cap);
    const reason = await resolveCapabilityProbeSkip(cap!, {
      ctx: {
        providerId: 'p',
        modelId: 'm',
        localServer: true,
        signal: new AbortController().signal,
      },
      workspaceRoot: '/tmp/cap-matrix-bench',
      capabilityFixturesSeeded: false,
    });
    assert.match(reason ?? '', /git fixture/i);
  });

  test('workspace probe skips when workspace root missing', async () => {
    const cap = getCapabilityById('core-parallel-tools');
    assert.ok(cap);
    const reason = await resolveCapabilityProbeSkip(cap!, {
      ctx: {
        providerId: 'p',
        modelId: 'm',
        localServer: true,
        signal: new AbortController().signal,
      },
      workspaceRoot: null,
    });
    assert.match(reason ?? '', /workspace unavailable/i);
  });

  test('mode-prompt rows skip when the prompt registry is unavailable', async () => {
    for (const id of PHASE_2G_MODE_PROMPT_CAPABILITY_IDS) {
      const cap = getCapabilityById(id);
      assert.ok(cap, id);
      assert.equal(isCapabilityProbeWaveEnabled(cap!), true, id);
      const reason = await resolveCapabilityProbeSkip(cap!, {
        ctx: {
          providerId: 'p',
          modelId: 'm',
          localServer: true,
          signal: new AbortController().signal,
        },
        workspaceRoot: '/tmp/cap-matrix-bench',
        capabilityFixturesSeeded: true,
        modePromptsReady: false,
      });
      assert.match(reason ?? '', /mode prompts unavailable/i, id);
    }
  });

  test('mode-prompt rows run once prompts and workspace are ready', async () => {
    for (const id of PHASE_2G_MODE_PROMPT_CAPABILITY_IDS) {
      const cap = getCapabilityById(id);
      assert.ok(cap, id);
      const reason = await resolveCapabilityProbeSkip(cap!, {
        ctx: {
          providerId: 'p',
          modelId: 'm',
          localServer: true,
          signal: new AbortController().signal,
        },
        workspaceRoot: '/tmp/cap-matrix-bench',
        capabilityFixturesSeeded: true,
        modePromptsReady: true,
      });
      assert.equal(reason, null, id);
    }
  });

  test('modes-general runs without local server when wave-enabled', async () => {
    const cap = getCapabilityById('modes-general');
    assert.ok(cap);
    const reason = await resolveCapabilityProbeSkip(cap!, {
      ctx: {
        providerId: 'p',
        modelId: 'm',
        localServer: false,
        signal: new AbortController().signal,
      },
    });
    assert.equal(reason, null);
  });
});
