import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseResearchBrief } from '../../src/research/parse-brief.ts';

const SAMPLE = `# Widget Study

## TL;DR
Widgets are useful.

## Key findings

### Performance
Widgets score well on benchmarks [1].

## Suggested follow-ups
- Compare widget latency
- Widget pricing trends

## Sources
1. https://example.com
`;

describe('parseResearchBrief', () => {
  test('extracts title, tldr, findings, and follow-ups', () => {
    const brief = parseResearchBrief(
      SAMPLE,
      [{ url: 'https://example.com', title: 'Example' }],
      'Fallback title',
    );
    assert.equal(brief.title, 'Widget Study');
    assert.match(brief.tldr, /Widgets are useful/);
    assert.equal(brief.findings.length, 1);
    assert.equal(brief.findings[0].heading, 'Performance');
    assert.equal(brief.followups.length, 2);
    assert.equal(brief.sources.length, 1);
    assert.equal(brief.sources[0].host, 'example.com');
  });
});
