/**
 * Client-side Impeccable reference augmentation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { augmentImpeccableSkillBody } from '../../src/skills/impeccable-client.ts';

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
