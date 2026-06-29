/**
 * Client-side Impeccable composed skill body (v3 harness routing).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  commandsForImpeccableAugment,
  composeImpeccableSkillBody,
  parseImpeccableSubcommand,
} from '../../src/skills/impeccable-client.ts';

const MINNOW_ADDENDUM = '# Impeccable (Minnow addendum)';

function mockFetch(handlers: Record<string, () => Response | Promise<Response>>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [needle, handler] of Object.entries(handlers)) {
      if (url.includes(needle)) {
        return handler();
      }
    }
    return { ok: false } as Response;
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe('composeImpeccableSkillBody', () => {
  it('appends init active command when fetch returns init content', async () => {
    const restore = mockFetch({
      '/api/skills/impeccable/upstream': () =>
        ({
          ok: true,
          json: async () => ({ content: '## Upstream routing rules' }),
        }) as Response,
      '/api/skills/impeccable/reference/init': () =>
        ({
          ok: true,
          json: async () => ({
            command: 'init',
            content: '# Init Flow\n\nWrites PRODUCT.md.',
          }),
        }) as Response,
    });

    try {
      const body = await composeImpeccableSkillBody(MINNOW_ADDENDUM, 'init');
      assert.match(body, /Impeccable \(Minnow addendum\)/);
      assert.match(body, /Upstream routing rules/);
      assert.match(body, /## Active Impeccable command: init/);
      assert.match(body, /do not run `npx impeccable init`/);
      assert.match(body, /# Init Flow/);
      assert.match(body, /PRODUCT\.md/);
    } finally {
      restore();
    }
  });

  it('teach alias composes init workflow', async () => {
    const restore = mockFetch({
      '/api/skills/impeccable/upstream': () =>
        ({ ok: false }) as Response,
      '/api/skills/impeccable/reference/init': () =>
        ({
          ok: true,
          json: async () => ({
            command: 'init',
            content: '# Init Flow\n\nStep 1.',
          }),
        }) as Response,
    });

    try {
      assert.deepEqual(parseImpeccableSubcommand('teach'), {
        command: 'init',
        target: '',
      });
      const body = await composeImpeccableSkillBody(MINNOW_ADDENDUM, 'teach');
      assert.match(body, /## Active Impeccable command: init/);
      assert.match(body, /# Init Flow/);
    } finally {
      restore();
    }
  });

  it('appends polish active command section', async () => {
    const restore = mockFetch({
      '/api/skills/impeccable/upstream': () =>
        ({ ok: false }) as Response,
      '/api/skills/impeccable/reference/polish': () =>
        ({
          ok: true,
          json: async () => ({
            command: 'polish',
            content: '# Polish\n\n## Pre-Polish Assessment\n\nChecklist.',
          }),
        }) as Response,
    });

    try {
      const body = await composeImpeccableSkillBody(
        MINNOW_ADDENDUM,
        'polish sidebar',
      );
      assert.match(body, /## Active Impeccable command: polish/);
      assert.match(body, /Pre-Polish/);
    } finally {
      restore();
    }
  });

  it('injects shape prerequisite when command is craft', async () => {
    const restore = mockFetch({
      '/api/skills/impeccable/upstream': () =>
        ({ ok: false }) as Response,
      '/api/skills/impeccable/reference/craft': () =>
        ({
          ok: true,
          json: async () => ({ content: '# Craft Flow\n\nStep 1 shape.' }),
        }) as Response,
      '/api/skills/impeccable/reference/shape': () =>
        ({
          ok: true,
          json: async () => ({
            content: '# Shape Flow\n\nDiscovery Interview.',
          }),
        }) as Response,
    });

    try {
      const body = await composeImpeccableSkillBody(
        MINNOW_ADDENDUM,
        'craft landing page redesign',
      );
      assert.match(body, /## Active Impeccable command: craft/);
      assert.match(body, /## Prerequisite workflow: shape/);
      assert.match(body, /# Craft Flow/);
      assert.match(body, /# Shape Flow/);
      assert.match(body, /Discovery Interview/);
    } finally {
      restore();
    }
  });

  it('commandsForImpeccableAugment lists craft then shape', () => {
    assert.deepEqual(commandsForImpeccableAugment('craft'), ['craft', 'shape']);
  });

  it('returns addendum only when primary reference fetch fails', async () => {
    const restore = mockFetch({
      '/api/skills/impeccable/upstream': () =>
        ({ ok: false }) as Response,
      '/api/skills/impeccable/reference/init': () =>
        ({ ok: false }) as Response,
    });

    try {
      const body = await composeImpeccableSkillBody(MINNOW_ADDENDUM, 'init');
      assert.equal(body, MINNOW_ADDENDUM);
    } finally {
      restore();
    }
  });
});
