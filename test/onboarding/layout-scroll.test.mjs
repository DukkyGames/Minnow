/**
 * MIN-453 — onboarding step content and sidebar phases scroll when they overflow.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const onboardingCss = readFileSync(join(root, 'src/styles/onboarding.css'), 'utf8');

function ruleBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = onboardingCss.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{[^}]+\\}`, 's'));
  return match?.[0] ?? '';
}

describe('onboarding layout scroll (MIN-453)', () => {
  test('overlay constrains grid children to the viewport', () => {
    const rootRule = ruleBlock('.mn-onboarding');
    const mainRule = ruleBlock('.mn-onboarding__main');
    assert.match(rootRule, /overflow:\s*hidden/);
    assert.match(mainRule, /min-height:\s*0/);
    assert.match(mainRule, /overflow:\s*hidden/);
  });

  test('step content scrolls instead of clipping tall steps', () => {
    const contentRule = onboardingCss.match(
      /\.mn-onboarding__content,\s*\n\.mn-onboarding-step\s*\{[^}]+\}/s,
    )?.[0];
    assert.ok(contentRule, 'expected shared content/step rule');
    assert.match(contentRule, /overflow-y:\s*auto/);
    assert.match(contentRule, /justify-content:\s*safe\s+center/);
    assert.match(contentRule, /overflow-y:\s*auto/);
  });

  test('welcome step keeps centered layout', () => {
    const welcomeRule = onboardingCss.match(
      /\.mn-onboarding-step--welcome,\s*\n\.mn-onboarding\.is-welcome \.mn-onboarding__content,\s*\n\.mn-onboarding\.is-welcome \.mn-onboarding-step\s*\{[^}]+\}/s,
    )?.[0];
    assert.ok(welcomeRule, 'expected welcome content rule');
    assert.match(welcomeRule, /justify-content:\s*flex-start/);
  });

  test('sidebar phase list scrolls independently of brand and progress', () => {
    const asideRule = ruleBlock('.mn-onboarding__aside');
    const phasesRule = ruleBlock('.mn-onboarding__phases');
    assert.match(asideRule, /overflow:\s*hidden/);
    assert.match(phasesRule, /overflow-y:\s*auto/);
    assert.match(phasesRule, /min-height:\s*0/);
  });
});
