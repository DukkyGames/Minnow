/**
 * Research report theme resolution — palette id validation + token extraction.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_THEME_ID,
  extractThemeTokensCss,
  normalizeThemeId,
  parseCustomTokensParam,
  resolveReportTheme,
} from '../../server/research/report-theme.js';

describe('report theme', () => {
  it('normalizes legacy and invalid theme ids', () => {
    assert.equal(normalizeThemeId('coral-dark'), 'coral-dark');
    assert.equal(normalizeThemeId('sage-light'), 'swamp-light');
    assert.equal(normalizeThemeId('dark'), 'swamp-dark');
    assert.equal(normalizeThemeId('not-a-theme'), DEFAULT_THEME_ID);
    assert.equal(normalizeThemeId(''), DEFAULT_THEME_ID);
  });

  it('extracts mn tokens for a palette block', () => {
    const css = extractThemeTokensCss('mint-dark');
    assert.match(css, /^:root \{/);
    assert.match(css, /--mn-bg:\s*#141615/);
    assert.match(css, /--mn-accent:/);
    assert.doesNotMatch(css, /data-theme=/);
  });

  it('resolveReportTheme returns meta color and color scheme', () => {
    const theme = resolveReportTheme('human-light');
    assert.equal(theme.themeId, 'human-light');
    assert.equal(theme.themeColor, '#fbf1ea');
    assert.equal(theme.colorScheme, 'light');
    assert.match(theme.themeTokensCss, /--mn-fg:/);
  });

  it('merges sanitized custom token overrides onto the palette block', () => {
    const theme = resolveReportTheme('swamp-dark', {
      bg: '#0a1628',
      'not-a-token': '#ffffff',
      accent: 'javascript:alert(1)',
    });
    assert.match(theme.themeTokensCss, /--mn-bg:\s*#0a1628/);
    assert.equal(theme.themeColor, '#0a1628');
    assert.doesNotMatch(theme.themeTokensCss, /javascript:/);
    assert.doesNotMatch(theme.themeTokensCss, /--mn-not-a-token/);
  });

  it('round-trips base64url custom token payloads', () => {
    const payload = { bg: '#141414', fg: '#e8e8e8', accent: '#7fd4ff' };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    assert.deepEqual(parseCustomTokensParam(encoded), payload);
  });
});
