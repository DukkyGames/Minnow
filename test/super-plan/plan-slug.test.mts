/**
 * Super Plan title → slug helpers.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createInterimPlanSlug,
  ensureUniquePlanSlug,
  extractPlanMarkdownTitle,
  slugFromPlanTitle,
} from '../../src/chat/super-plan/plan-slug.ts';

describe('plan slug helpers', () => {
  test('createInterimPlanSlug uses plan- prefix and stays short', () => {
    const slug = createInterimPlanSlug();
    assert.match(slug, /^plan-[a-f0-9]{8}$/);
  });

  test('slugFromPlanTitle kebab-cases and caps length', () => {
    assert.equal(slugFromPlanTitle('Real Feature Name'), 'real-feature-name');
    const long = slugFromPlanTitle(
      'This Is An Extremely Long Product Name That Should Be Truncated Somewhere',
    );
    assert.ok(long.length <= 50);
    assert.ok(!long.endsWith('-'));
  });

  test('extractPlanMarkdownTitle reads first H1 and skips generic headings', () => {
    const md = '# Build spec\n\nBody';
    assert.equal(extractPlanMarkdownTitle(md, 'fallback'), 'fallback');
    const good = '# OAuth Login Flow\n\nDetails';
    assert.equal(extractPlanMarkdownTitle(good, ''), 'OAuth Login Flow');
  });

  test('ensureUniquePlanSlug appends numeric suffix on collision', async () => {
    const existing = new Set(['documentation/plans/real-feature-name.md']);
    const slug = await ensureUniquePlanSlug('Real Feature Name', [], async (planPath) =>
      existing.has(planPath),
    );
    assert.equal(slug, 'real-feature-name-2');
  });
});
