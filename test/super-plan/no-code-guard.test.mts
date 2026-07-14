/**
 * Super Plan no-code-snippet guard tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  blockSuperPlanCodeSnippets,
  blockPlanModeWriteWithContent,
} from '../../src/chat/modes/plan-write-guard.ts';
import { validatePlanSaveNoCodeSnippets } from '../../src/chat/super-plan/no-code-guard.ts';

describe('validatePlanSaveNoCodeSnippets', () => {
  test('allows YAML front-matter and inline code', () => {
    const content = `---
name: my-plan
todos: []
---

# Plan

Modify \`src/foo.ts\` and call \`doThing()\`.
`;
    assert.equal(validatePlanSaveNoCodeSnippets(content), null);
  });

  test('allows bash fences in Test sections', () => {
    const content = `# Plan

#### Task W1-A: Setup
- **Build:** Add config file.
- **Test:** Run verification:

\`\`\`bash
npm test
\`\`\`
`;
    assert.equal(validatePlanSaveNoCodeSnippets(content), null);
  });

  test('rejects typescript implementation fences', () => {
    const content = `# Plan

\`\`\`typescript
export function foo() {
  return 1;
}
\`\`\`
`;
    assert.ok(validatePlanSaveNoCodeSnippets(content)?.includes('typescript'));
  });

  test('rejects javascript fences outside Test sections', () => {
    const content = `#### Task W1-A: Hook
- **Build:**

\`\`\`js
module.exports = {};
\`\`\`
`;
    assert.ok(validatePlanSaveNoCodeSnippets(content)?.includes('js'));
  });
});

describe('blockSuperPlanCodeSnippets', () => {
  test('blocks save_file with implementation fences in super-plan mode', () => {
    const msg = blockSuperPlanCodeSnippets('super-plan', 'save_file', {
      path: 'documentation/plans/feature.md',
      content: '```python\nprint("hi")\n```',
    });
    assert.ok(msg?.startsWith('Error:'));
  });

  test('does not block plan mode saves with code fences', () => {
    const msg = blockSuperPlanCodeSnippets('plan', 'save_file', {
      path: 'documentation/plans/feature.md',
      content: '```python\nx\n```',
    });
    assert.equal(msg, null);
  });

  test('blockPlanModeWriteWithContent combines path and content guards', () => {
    const pathBlock = blockPlanModeWriteWithContent('super-plan', 'save_file', {
      path: 'src/evil.ts',
      content: '# ok',
    });
    assert.ok(pathBlock?.includes('Super Plan'));

    const contentBlock = blockPlanModeWriteWithContent('super-plan', 'save_file', {
      path: 'documentation/plans/feature.md',
      content: '```rust\nfn main() {}\n```',
    });
    assert.ok(contentBlock?.includes('Error:'));
  });
});
