/**
 * P0-F — plan format schema and parsePlan().
 *
 * One test per quality requirement the Planner prompt states, because the
 * parser is now what enforces them. The prompt and this module change together
 * by rule, and the last suite here asserts they have not drifted.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  formatParseErrors,
  isParseErrors,
  parsePlan,
} from '../../server/orchestrator/core/parse-plan.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLANNER_PROMPT = path.join(
  PROJECT_ROOT,
  'src/chat/prompts/work-agents/planner/agent.full.md',
);

// ---------------------------------------------------------------------------
// The golden plan
// ---------------------------------------------------------------------------

const GOLDEN = `---
name: widget-rollout
overview: Ship the widget end to end.
todos:
  - id: W1-A
    content: "Wave 1: Add the store"
    status: pending
  - id: W1-B
    content: "Wave 1: Add the route"
    status: pending
  - id: W2-A
    content: "Wave 2: Wire the UI"
    status: pending
isProject: true
---

# Widget Rollout

**Date:** 2026-08-28
**Goal:** Ship the widget.

## Context
Because the widget does not exist yet.

## Architecture / Key Files
| File | Role | Action |
|------|------|--------|
| \`src/widget/store.ts\` | state | CREATE |

## Wave Breakdown

### Wave 1 — Foundations

#### Task W1-A: Add the store
- **Build:** Create \`src/widget/store.ts\` exporting \`createWidgetStore()\`.
  It holds the widget list and nothing else.
- **Test:** \`npm test -- widget-store\` passes.
- **Accept:** \`createWidgetStore()\` returns an empty list on a fresh call.
- **Touches:** src/widget/store.ts, src/widget/store.d.ts

#### Task W1-B: Add the route
- **Build:** Add \`GET /api/widgets\` in \`server/widgets/routes.js\`.
- **Test:** curl returns 200.
- **Accept:** The route returns \`{ widgets: [] }\`.
- **Touches:** \`server/widgets/**\`
- **Depends on:**

### Wave 2 — Integration

#### Task W2-A: Wire the UI
- **Build:** Render the list in \`src/ui/widget-panel.ts\`.
- **Test:** The panel test asserts three rows.
- **Accept:** The panel shows the widgets.
- **Touches:** src/ui/widget-panel.ts
- **Depends on:** W1-A, W1-B

## Verification Checklist
- [ ] \`npm test\` passes
`;

/** Replace one line of the golden plan, matched by a unique substring. */
function mutate(needle, replacement) {
  assert.equal(GOLDEN.split(needle).length, 2, `needle is not unique: ${needle}`);
  return GOLDEN.replace(needle, replacement);
}

/** Parse and require failure, returning the errors. */
function errorsOf(markdown) {
  const result = parsePlan(markdown);
  assert.equal(isParseErrors(result), true, 'expected a parse failure');
  assert.ok(result.length > 0);
  for (const error of result) {
    assert.equal(typeof error.line, 'number');
    assert.ok(error.line >= 1, 'line numbers are 1-based');
    assert.equal(typeof error.column, 'number');
    assert.ok(error.message.length > 0);
    assert.ok(error.hint.length > 0, `no hint for: ${error.message}`);
  }
  return result;
}

/** The 1-based line a substring appears on. */
function lineOf(markdown, needle) {
  return markdown.slice(0, markdown.indexOf(needle)).split('\n').length;
}

// ---------------------------------------------------------------------------

describe('parsePlan — the golden plan', () => {
  const graph = parsePlan(GOLDEN);

  it('parses without error', () => {
    assert.equal(isParseErrors(graph), false, JSON.stringify(graph, null, 2));
  });

  it('reads the front matter', () => {
    assert.equal(graph.name, 'widget-rollout');
    assert.equal(graph.overview, 'Ship the widget end to end.');
    assert.equal(graph.isProject, true);
    assert.equal(graph.title, 'Widget Rollout');
  });

  it('reads the waves', () => {
    assert.deepEqual(graph.waves, [
      { n: 1, name: 'Foundations' },
      { n: 2, name: 'Integration' },
    ]);
  });

  it('reads every task with explicit dependency edges', () => {
    assert.deepEqual(graph.tasks.map((t) => t.id), ['W1-A', 'W1-B', 'W2-A']);
    assert.deepEqual(graph.tasks.map((t) => t.wave), [1, 1, 2]);
    assert.deepEqual(graph.tasks.map((t) => t.dependsOn), [[], [], ['W1-A', 'W1-B']]);
    assert.equal(graph.tasks[0].title, 'Add the store');
  });

  it('reads touches as a glob list, stripping backticks', () => {
    assert.deepEqual(graph.tasks[0].touches, ['src/widget/store.ts', 'src/widget/store.d.ts']);
    assert.deepEqual(graph.tasks[1].touches, ['server/widgets/**']);
  });

  it('keeps multi-line Build text', () => {
    assert.match(graph.tasks[0].build, /createWidgetStore\(\)/);
    assert.match(graph.tasks[0].build, /It holds the widget list and nothing else\./);
    assert.equal(graph.tasks[0].test, '`npm test -- widget-store` passes.');
  });

  it('records the heading line of every task', () => {
    for (const task of graph.tasks) {
      assert.equal(task.line, lineOf(GOLDEN, `#### Task ${task.id}:`));
    }
  });

  it('is deterministic across 100 parses', () => {
    const first = JSON.stringify(parsePlan(GOLDEN));
    for (let i = 0; i < 100; i += 1) assert.equal(JSON.stringify(parsePlan(GOLDEN)), first);
  });

  it('parses identically with CRLF line endings', () => {
    assert.deepEqual(parsePlan(GOLDEN.replace(/\n/g, '\r\n')), graph);
  });
});

// ---------------------------------------------------------------------------

describe('parsePlan — one test per quality requirement', () => {
  it('rejects a task with no Build', () => {
    const source = mutate('- **Build:** Add `GET /api/widgets` in `server/widgets/routes.js`.\n', '');
    const [error] = errorsOf(source);
    assert.match(error.message, /task W1-B has no \*\*Build:\*\*/);
    assert.equal(error.line, lineOf(source, '#### Task W1-B:'));
  });

  it('rejects a task with no Test', () => {
    const source = mutate('- **Test:** curl returns 200.\n', '');
    assert.match(errorsOf(source)[0].message, /task W1-B has no \*\*Test:\*\*/);
  });

  it('rejects a task with no Accept', () => {
    const source = mutate('- **Accept:** The route returns `{ widgets: [] }`.\n', '');
    assert.match(errorsOf(source)[0].message, /task W1-B has no \*\*Accept:\*\*/);
  });

  it('rejects a task with no Touches', () => {
    const source = mutate('- **Touches:** `server/widgets/**`\n', '');
    const [error] = errorsOf(source);
    assert.match(error.message, /task W1-B has no \*\*Touches:\*\*/);
    assert.match(error.hint, /globs/);
  });

  it('rejects a todo with no matching task', () => {
    const source = mutate(
      '  - id: W2-A\n',
      '  - id: W2-A\n    content: "x"\n    status: pending\n  - id: W9-Z\n',
    );
    const [error] = errorsOf(source);
    assert.match(error.message, /todo `W9-Z` has no matching/);
    assert.equal(error.line, lineOf(source, '  - id: W9-Z'));
  });

  it('rejects a task with no matching todo', () => {
    const source = mutate('  - id: W2-A\n    content: "Wave 2: Wire the UI"\n    status: pending\n', '');
    const [error] = errorsOf(source);
    assert.match(error.message, /task W2-A has no matching entry in the front-matter todos/);
    assert.equal(error.line, lineOf(source, '#### Task W2-A:'));
  });

  it('rejects a dependsOn naming an unknown id', () => {
    const source = mutate('- **Depends on:** W1-A, W1-B', '- **Depends on:** W1-A, W9-NOPE');
    const [error] = errorsOf(source);
    assert.match(error.message, /task W2-A depends on `W9-NOPE`, which is not a task in this plan/);
    assert.equal(error.line, lineOf(source, '#### Task W2-A:'));
  });

  it('rejects a two-node cycle', () => {
    const source = mutate('- **Depends on:**\n', '- **Depends on:** W2-A\n');
    const errors = errorsOf(source);
    const cycle = errors.find((e) => /dependency cycle/.test(e.message));
    assert.ok(cycle, JSON.stringify(errors));
    assert.match(cycle.message, /W1-B/);
    assert.match(cycle.message, /W2-A/);
    assert.match(cycle.hint, /break the cycle/);
  });

  it('rejects a three-node cycle', () => {
    const source = GOLDEN.replace('- **Depends on:**\n', '- **Depends on:** W2-A\n').replace(
      '- **Touches:** src/widget/store.ts, src/widget/store.d.ts',
      '- **Touches:** src/widget/store.ts\n- **Depends on:** W1-B',
    );
    const errors = errorsOf(source);
    const cycle = errors.find((e) => /dependency cycle/.test(e.message));
    assert.ok(cycle, JSON.stringify(errors));
    for (const id of ['W1-A', 'W1-B', 'W2-A']) assert.match(cycle.message, new RegExp(id));
  });

  it('rejects a self-dependency', () => {
    const source = mutate('- **Depends on:** W1-A, W1-B', '- **Depends on:** W2-A');
    assert.match(errorsOf(source)[0].message, /task W2-A depends on itself/);
  });

  it('rejects a duplicate task id', () => {
    const source = mutate('#### Task W1-B: Add the route', '#### Task W1-A: Add the route');
    assert.ok(errorsOf(source).some((e) => /duplicate task id W1-A/.test(e.message)));
  });

  it('rejects a glob the scheduler could not reason about', () => {
    // A pattern `touchesOverlap()` cannot interpret is worse than a rejected
    // one: it reads as "overlaps nothing" and the concurrency gate opens on two
    // tasks writing the same file. So the parser only admits syntax the
    // intersection actually implements.
    for (const [glob, pattern] of [
      ['/etc/passwd', /repo-relative/],
      ['../../secrets/**', /escape the repo/],
      ['src/[unclosed/**', /unbalanced \[ \]/],
      ['src/{a', /brace expansion is not supported/],
      ['src/{ui}/**', /brace expansion is not supported/],
      ['!src/generated/**', /negated globs are not supported/],
      ['src/a.ts (new file)', /looks like prose/],
      ['src/my file.ts', /may not contain whitespace/],
    ]) {
      const source = mutate('- **Touches:** src/ui/widget-panel.ts', `- **Touches:** ${glob}`);
      const [error] = errorsOf(source);
      assert.match(error.message, /task W2-A declares an invalid glob/, glob);
      assert.match(error.message, pattern, glob);
    }
  });
});

// ---------------------------------------------------------------------------

describe('parsePlan — document-level failures', () => {
  it('rejects a document with no front matter', () => {
    const [error] = errorsOf(GOLDEN.slice(GOLDEN.indexOf('# Widget')));
    assert.match(error.message, /missing YAML front matter/);
    assert.equal(error.line, 1);
  });

  it('rejects unterminated front matter', () => {
    assert.match(errorsOf('---\nname: x\n# Title\n')[0].message, /never closed/);
  });

  it('rejects front matter with no name', () => {
    const source = mutate('name: widget-rollout\n', '');
    assert.ok(errorsOf(source).some((e) => /no `name`/.test(e.message)));
  });

  it('rejects front matter with no todos', () => {
    const source = GOLDEN.replace(/todos:\n(?:  .*\n)+/, '');
    assert.ok(errorsOf(source).some((e) => /no `todos` entries/.test(e.message)));
  });

  it('rejects a plan with no Wave Breakdown section', () => {
    const source = mutate('## Wave Breakdown', '## Something Else');
    assert.match(errorsOf(source)[0].message, /no `## Wave Breakdown` section/);
  });

  it('rejects a Wave Breakdown with no tasks', () => {
    const source = GOLDEN.slice(0, GOLDEN.indexOf('### Wave 1')) + '## Verification Checklist\n';
    assert.ok(errorsOf(source).some((e) => /declares no tasks/.test(e.message)));
  });

  it('rejects a malformed wave heading', () => {
    const source = mutate('### Wave 1 — Foundations', '### Foundations');
    assert.match(errorsOf(source)[0].message, /wave heading is malformed/);
  });

  it('rejects a malformed task heading', () => {
    const source = mutate('#### Task W1-A: Add the store', '#### W1-A Add the store');
    assert.ok(errorsOf(source).some((e) => /task heading is malformed/.test(e.message)));
  });

  it('reports errors in document order', () => {
    const source = GOLDEN.replace('- **Test:** curl returns 200.\n', '').replace(
      '- **Touches:** src/ui/widget-panel.ts',
      '- **Touches:** /absolute/**',
    );
    const errors = errorsOf(source);
    for (let i = 1; i < errors.length; i += 1) {
      assert.ok(errors[i].line >= errors[i - 1].line, 'errors are out of order');
    }
  });

  it('formats errors with their line and hint', () => {
    const text = formatParseErrors(errorsOf('nonsense'));
    assert.match(text, /^line \d+:\d+ — /m);
    assert.match(text, /hint: /);
  });
});

// ---------------------------------------------------------------------------

describe('parsePlan — field layout variants', () => {
  it('keeps nested list items under an empty - **Build:** bullet', () => {
    // The failure mode behind "task has no **Build:**" on otherwise valid plans:
    // Planner writes `- **Build:**` then indented step bullets. Rejecting any
    // `[-*] ` continuation line dropped the entire Build body.
    const source = GOLDEN.replace(
      '- **Build:** Add `GET /api/widgets` in `server/widgets/routes.js`.\n',
      '- **Build:**\n  - Add `GET /api/widgets` in `server/widgets/routes.js`.\n  - Return an empty list.\n',
    );
    const graph = parsePlan(source);
    assert.equal(isParseErrors(graph), false, isParseErrors(graph) ? formatParseErrors(graph) : '');
    assert.match(graph.tasks[1].build, /GET \/api\/widgets/);
    assert.match(graph.tasks[1].build, /Return an empty list/);
  });

  it('accepts plain bullet labels with a required colon', () => {
    const source = GOLDEN.replace(
      '- **Build:** Add `GET /api/widgets` in `server/widgets/routes.js`.\n- **Test:** curl returns 200.\n- **Accept:** The route returns `{ widgets: [] }`.\n- **Touches:** `server/widgets/**`\n',
      '- Build: Add `GET /api/widgets` in `server/widgets/routes.js`.\n- Test: curl returns 200.\n- Accept: The route returns `{ widgets: [] }`.\n- Touches: `server/widgets/**`\n',
    );
    const graph = parsePlan(source);
    assert.equal(isParseErrors(graph), false, isParseErrors(graph) ? formatParseErrors(graph) : '');
    assert.match(graph.tasks[1].build, /GET \/api\/widgets/);
    assert.equal(graph.tasks[1].test, 'curl returns 200.');
  });

  it('accepts bare **Build:** / Build: headings with body on following lines', () => {
    const source = GOLDEN.replace(
      '- **Build:** Add `GET /api/widgets` in `server/widgets/routes.js`.\n- **Test:** curl returns 200.\n- **Accept:** The route returns `{ widgets: [] }`.\n- **Touches:** `server/widgets/**`\n',
      '**Build:**\nAdd `GET /api/widgets` in `server/widgets/routes.js`.\nTest:\ncurl returns 200.\n**Accept:** The route returns `{ widgets: [] }`.\nTouches: `server/widgets/**`\n',
    );
    const graph = parsePlan(source);
    assert.equal(isParseErrors(graph), false, isParseErrors(graph) ? formatParseErrors(graph) : '');
    assert.match(graph.tasks[1].build, /GET \/api\/widgets/);
    assert.equal(graph.tasks[1].test, 'curl returns 200.');
    assert.match(graph.tasks[1].accept, /widgets: \[\]/);
    assert.deepEqual(graph.tasks[1].touches, ['server/widgets/**']);
  });

  it('accepts - **Build** without a colon', () => {
    const source = mutate(
      '- **Build:** Add `GET /api/widgets` in `server/widgets/routes.js`.',
      '- **Build** Add `GET /api/widgets` in `server/widgets/routes.js`.',
    );
    const graph = parsePlan(source);
    assert.equal(isParseErrors(graph), false, isParseErrors(graph) ? formatParseErrors(graph) : '');
    assert.match(graph.tasks[1].build, /GET \/api\/widgets/);
  });
});

describe('parsePlan — the retired workaround', () => {
  it('parses an absent and an empty Depends on identically', () => {
    // Absent Depends-on and empty Depends-on must parse the same. The parser
    // is the source of truth — prompts must not paper over that.
    const absent = parsePlan(
      mutate('- **Touches:** `server/widgets/**`\n- **Depends on:**\n', '- **Touches:** `server/widgets/**`\n'),
    );
    const empty = parsePlan(GOLDEN);
    assert.equal(isParseErrors(absent), false);
    assert.deepEqual(
      absent.tasks.map((t) => t.dependsOn),
      empty.tasks.map((t) => t.dependsOn),
    );
  });

  it('treats placeholder values for no dependencies as none', () => {
    for (const placeholder of [
      'none',
      'None',
      'none.',
      'None.',
      'nothing',
      '(none)',
      '`none`',
      '**none**',
      'n/a',
      '—',
      '-',
    ]) {
      const source = mutate('- **Depends on:**\n', `- **Depends on:** ${placeholder}\n`);
      const graph = parsePlan(source);
      assert.equal(isParseErrors(graph), false, placeholder);
      assert.deepEqual(graph.tasks[1].dependsOn, [], placeholder);
    }
  });

  it('keeps every entry of a wrapped Touches or Depends on list', () => {
    // The continuation handler used to lower-case the field name, writing
    // `touchesraw` / `dependsraw` — properties nothing read. A wrapped list
    // silently lost every entry after the first, with no parse error: exactly
    // the dropped-edge failure this parser exists to prevent.
    const wrapped = GOLDEN.replace(
      '- **Touches:** src/ui/widget-panel.ts\n- **Depends on:** W1-A, W1-B',
      '- **Touches:** src/ui/widget-panel.ts,\n  src/ui/widget-row.ts\n- **Depends on:** W1-A,\n  W1-B',
    );
    const graph = parsePlan(wrapped);
    assert.equal(isParseErrors(graph), false, isParseErrors(graph) ? formatParseErrors(graph) : '');
    assert.deepEqual(graph.tasks[2].touches, ['src/ui/widget-panel.ts', 'src/ui/widget-row.ts']);
    assert.deepEqual(graph.tasks[2].dependsOn, ['W1-A', 'W1-B']);
  });

  it('matches todo ids to task ids case-insensitively', () => {
    const source = GOLDEN.replace('  - id: W1-A', '  - id: w1-a');
    const graph = parsePlan(source);
    assert.equal(isParseErrors(graph), false);
    assert.equal(graph.tasks[0].id, 'W1-A', 'the declared casing is what the graph keeps');
  });

  it('de-duplicates a repeated dependency', () => {
    const source = mutate('- **Depends on:** W1-A, W1-B', '- **Depends on:** W1-A, W1-A, W1-B');
    const graph = parsePlan(source);
    assert.equal(isParseErrors(graph), false);
    assert.deepEqual(graph.tasks[2].dependsOn, ['W1-A', 'W1-B']);
  });
});

// ---------------------------------------------------------------------------

describe('parsePlan — fuzz', () => {
  /** Deterministic PRNG so a failure reproduces from its seed. */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Corrupt the golden plan in a seeded, structurally varied way. */
  function corrupt(seed) {
    const r = rng(seed);
    let lines = GOLDEN.split('\n');
    const rounds = 1 + Math.floor(r() * 6);
    for (let i = 0; i < rounds; i += 1) {
      const at = Math.floor(r() * lines.length);
      const roll = r();
      if (roll < 0.25) lines.splice(at, 1);
      else if (roll < 0.5) lines[at] = lines[at].slice(0, Math.floor(r() * lines[at].length));
      else if (roll < 0.7) lines.splice(at, 0, '#'.repeat(1 + Math.floor(r() * 6)) + ' junk');
      else if (roll < 0.85) lines[at] = `${lines[at]}${lines[Math.floor(r() * lines.length)]}`;
      else lines.splice(at, 0, '- **Depends on:** ' + String.fromCharCode(65 + Math.floor(r() * 26)));
    }
    return lines.join('\n');
  }

  it('never throws and never returns a partial graph across 500 corrupted plans', () => {
    let failures = 0;
    for (let seed = 1; seed <= 500; seed += 1) {
      const source = corrupt(seed);
      let result;
      assert.doesNotThrow(() => {
        result = parsePlan(source);
      }, `seed ${seed} threw`);

      if (isParseErrors(result)) {
        failures += 1;
        for (const error of result) {
          assert.ok(Number.isInteger(error.line) && error.line >= 1, `seed ${seed}: bad line`);
          assert.ok(error.message.length > 0 && error.hint.length > 0, `seed ${seed}: bare error`);
        }
        continue;
      }

      // A graph that parsed must be complete: every task fully specified, every
      // edge resolved, and acyclic.
      const ids = new Set(result.tasks.map((t) => t.id));
      for (const task of result.tasks) {
        assert.ok(task.id && task.title, `seed ${seed}: incomplete task`);
        assert.ok(task.build && task.test && task.accept, `seed ${seed}: missing field`);
        assert.ok(task.touches.length > 0, `seed ${seed}: no touches`);
        for (const dep of task.dependsOn) {
          assert.ok(ids.has(dep), `seed ${seed}: dangling edge ${task.id} -> ${dep}`);
        }
      }
    }
    // The corruptor is only useful if it actually breaks things.
    assert.ok(failures > 100, `only ${failures} of 500 corruptions were rejected`);
  });

  it('never throws on adversarial input', () => {
    for (const input of [
      '',
      null,
      undefined,
      '---\n---\n',
      '---\n'.repeat(500),
      '#### Task '.repeat(2000),
      '---\nname: x\ntodos:\n  - id: A\n---\n# T\n## Wave Breakdown\n### Wave 1 — W\n' +
        '#### Task A: T\n- **Build:** b\n- **Test:** t\n- **Accept:** a\n- **Touches:** src/**\n- **Depends on:** A\n',
      '\u0000\uFFFF\n---\n',
    ]) {
      assert.doesNotThrow(() => parsePlan(input), JSON.stringify(String(input).slice(0, 30)));
    }
  });
});

// ---------------------------------------------------------------------------

describe('the Planner prompt and the parser cannot drift', () => {
  // The prompt file is CRLF on this checkout; normalise so the fence regexes below
  // match the same way they would on a LF checkout.
  const prompt = fs.readFileSync(PLANNER_PROMPT, 'utf8').split('\r\n').join('\n');

  it('the prompt schema block declares Touches on every task', () => {
    assert.match(prompt, /- \*\*Touches:\*\*/);
    assert.ok(
      prompt.split('- **Touches:**').length - 1 >= 2,
      'both sample tasks must show the field',
    );
  });

  it('the quality requirements name Touches as non-negotiable', () => {
    assert.match(prompt, /Every task has Build \+ Test \+ Accept \+ Touches sub-tasks/);
    assert.match(prompt, /Every task declares `Touches:`/);
  });

  it('the prompt tells the Planner todo ids are task ids', () => {
    assert.match(prompt, /each `id` is the task id exactly/);
    assert.match(prompt, /- id: W1-A/);
  });

  it('the prompt no longer asks for the empty-list workaround', () => {
    assert.match(prompt, /Omitting the line and writing an empty one mean the same thing/);
  });

  it('the schema block in the prompt parses', () => {
    // The strongest anti-drift check available: take the schema the Planner is
    // shown, substitute its placeholders, and run it through the real parser. If
    // the documented shape stops being a valid plan, this fails.
    const block = /```markdown\n([\s\S]*?)```/.exec(prompt);
    assert.ok(block, 'the prompt has no ```markdown schema block');

    const filled = block[1]
      // Bullet values first, so the generic <...> sweep cannot reach them.
      // W2-A's sample carries real task ids and must survive; the others are prose.
      .replace(/^- \*\*Depends on:\*\*.*$/gm, (line) =>
        /W1-[AB]/.test(line) ? line : '- **Depends on:**')
      .replace(/^- \*\*Touches:\*\*.*$/gm, '- **Touches:** src/placeholder/**')
      .replace(/^(- \*\*(?:Build|Test|Accept):\*\*).*$/gm, '$1 placeholder')
      .replace(/<plan-kebab-name>/g, 'demo-plan')
      .replace(/<one-paragraph summary>/g, 'A demo.')
      .replace(/<[^>\n]*>/g, 'placeholder');

    const result = parsePlan(filled);
    assert.equal(
      isParseErrors(result),
      false,
      isParseErrors(result) ? formatParseErrors(result) : '',
    );
    assert.deepEqual(result.tasks.map((t) => t.id), ['W1-A', 'W1-B', 'W2-A']);
    assert.deepEqual(result.tasks.map((t) => t.wave), [1, 1, 2]);
    // And the sample demonstrates the cross-wave edge it documents.
    assert.deepEqual(result.tasks[2].dependsOn, ['W1-A', 'W1-B']);
  });
});
