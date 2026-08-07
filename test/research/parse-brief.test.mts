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

  test('every finding is stripped and cited, not just the last one', () => {
    const brief = parseResearchBrief(
      `## Key findings

### First
Uses [a link](https://example.com/a) and **bold** [1].

### Second
Plain body [2].
`,
      [],
      'Fallback',
    );

    assert.equal(brief.findings.length, 2);
    assert.deepEqual(brief.findings[0].cites, [1]);
    assert.deepEqual(brief.findings[1].cites, [2]);
    assert.doesNotMatch(brief.findings[0].body, /\]\(https/);
    assert.doesNotMatch(brief.findings[0].body, /\*\*/);
  });

  test('a finding body keeps its subheadings, paragraphs and lists', () => {
    const brief = parseResearchBrief(
      `## Key findings

### Attention

#### Why it works
Tokens attend in parallel.

Scores are normalised.

- Queries and keys are projections
- Heads attend to different relations
`,
      [],
      'Fallback',
    );

    const blocks = brief.findings[0].blocks ?? [];
    assert.deepEqual(
      blocks.map((b) => b.kind),
      ['sub', 'para', 'para', 'list'],
    );
    assert.equal(blocks[0].kind === 'sub' && blocks[0].text, 'Why it works');
    assert.equal(blocks[3].kind === 'list' && blocks[3].items.length, 2);
    assert.doesNotMatch(brief.findings[0].body, /#/);
  });
});
