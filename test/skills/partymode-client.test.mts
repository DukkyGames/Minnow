/**
 * Party mode client helpers — stop phrases and skill body augment.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  augmentPartyModeSkillBody,
  isPartyModePinned,
  isPartyModeStopPhrase,
  PARTYMODE_SKILL_ID,
} from '../../src/skills/partymode-client.ts';

describe('partymode-client', () => {
  it('exports stable skill id', () => {
    assert.equal(PARTYMODE_SKILL_ID, 'partymode');
  });

  it('detects stop phrases', () => {
    assert.equal(isPartyModeStopPhrase('stop party'), true);
    assert.equal(isPartyModeStopPhrase('stop party mode please'), true);
    assert.equal(isPartyModeStopPhrase("party's over"), true);
    assert.equal(isPartyModeStopPhrase('partys over'), true);
    assert.equal(isPartyModeStopPhrase('let us party'), false);
  });

  it('detects pinned party mode', () => {
    assert.equal(isPartyModePinned({ id: 'partymode' }), true);
    assert.equal(isPartyModePinned({ id: 'caveman' }), false);
    assert.equal(isPartyModePinned(null), false);
  });

  it('augments skill body with active session block', () => {
    const out = augmentPartyModeSkillBody('Bird Man rules');
    assert.match(out, /Bird Man rules/);
    assert.match(out, /Do you guys like to party\?/);
  });
});
