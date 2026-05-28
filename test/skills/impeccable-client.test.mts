/**
 * Client-side Impeccable reference augmentation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  augmentImpeccableSkillBody,
  commandsForImpeccableAugment,
} from '../../src/skills/impeccable-client.ts';

describe('augmentImpeccableSkillBody', () => {
  it('appends active command header when fetch returns content', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      ({
        ok: true,
        json: async () => ({ command: 'teach', content: '# Teach Flow\n\nStep 1.' }),
      }) as Response;

    try {
      const body = await augmentImpeccableSkillBody('# Impeccable', 'teach');
      assert.match(body, /## Active Impeccable command: teach/);
      assert.match(body, /do not run `npx impeccable teach`/);
      assert.match(body, /# Teach Flow/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('injects shape prerequisite when command is craft', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/reference/craft')) {
        return {
          ok: true,
          json: async () => ({ content: '# Craft Flow\n\nStep 1 shape.' }),
        } as Response;
      }
      if (url.includes('/reference/shape')) {
        return {
          ok: true,
          json: async () => ({ content: '# Shape Flow\n\nDiscovery Interview.' }),
        } as Response;
      }
      return { ok: false } as Response;
    };

    try {
      const body = await augmentImpeccableSkillBody(
        '# Impeccable',
        'craft landing page redesign',
      );
      assert.match(body, /## Active Impeccable command: craft/);
      assert.match(body, /## Prerequisite workflow: shape/);
      assert.match(body, /# Craft Flow/);
      assert.match(body, /# Shape Flow/);
      assert.match(body, /Discovery Interview/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('commandsForImpeccableAugment lists craft then shape', () => {
    assert.deepEqual(commandsForImpeccableAugment('craft'), ['craft', 'shape']);
  });

  it('returns original body when fetch fails', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false }) as Response;

    try {
      const base = '# Impeccable base';
      const body = await augmentImpeccableSkillBody(base, 'teach');
      assert.equal(body, base);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
