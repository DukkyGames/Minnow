/**
 * Caveman client: intensity parsing and skill body augmentation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  augmentCavemanSkillBody,
  CAVEMAN_SKILL_ID,
  parseCavemanIntensity,
  stripLeadingCavemanIntensity,
} from '../../src/skills/caveman-client.ts';

describe('parseCavemanIntensity', () => {
  it('parses known levels from first token', () => {
    assert.equal(parseCavemanIntensity('ultra explain hooks'), 'ultra');
    assert.equal(parseCavemanIntensity('wenyan-full why slow'), 'wenyan-full');
    assert.equal(parseCavemanIntensity('full'), 'full');
  });

  it('returns null for unknown first token', () => {
    assert.equal(parseCavemanIntensity('explain useEffect'), null);
    assert.equal(parseCavemanIntensity(''), null);
  });
});

describe('stripLeadingCavemanIntensity', () => {
  it('removes leading intensity token', () => {
    const out = stripLeadingCavemanIntensity('lite explain map');
    assert.equal(out.intensity, 'lite');
    assert.equal(out.userText, 'explain map');
  });
});

describe('augmentCavemanSkillBody', () => {
  it('appends active intensity from user text', () => {
    const body = augmentCavemanSkillBody('Base skill', {
      userText: 'ultra why rerender',
      pinnedIntensity: 'full',
    });
    assert.match(body, /## Active intensity: ultra/);
  });

  it('falls back to pinned intensity', () => {
    const body = augmentCavemanSkillBody('Base skill', {
      userText: 'why rerender',
      pinnedIntensity: 'wenyan-lite',
    });
    assert.match(body, /## Active intensity: wenyan-lite/);
  });

  it('defaults to full when no level provided', () => {
    const body = augmentCavemanSkillBody('Base skill', {
      userText: 'why rerender',
      pinnedIntensity: null,
    });
    assert.match(body, /## Active intensity: full/);
  });
});

describe('CAVEMAN_SKILL_ID', () => {
  it('matches folder id', () => {
    assert.equal(CAVEMAN_SKILL_ID, 'caveman');
  });
});
