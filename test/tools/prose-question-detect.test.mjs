/**
 * Heuristic detection for prose that should use ask_question.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { looksLikeProseStructuredQuestion } from '../../src/tools/prose-question-detect.ts';

describe('looksLikeProseStructuredQuestion', () => {
  test('detects numbered options with a question', () => {
    const text = `Which scope should we target first?

1. MVP — auth and dashboard only
2. Full product — all modules in the backlog
3. Defer non-critical features`;

    assert.equal(looksLikeProseStructuredQuestion(text), true);
  });

  test('detects lettered inline options with choice phrase', () => {
    const text =
      'Please choose one path forward: A) refactor the API layer first, B) ship UI fixes first, C) pause until design review.';
    assert.equal(looksLikeProseStructuredQuestion(text), true);
  });

  test('ignores procedural numbered steps without a choice question', () => {
    const text = `Here is how to run the migration:

1. Stop the dev server
2. Run npm run migrate
3. Restart and verify logs`;

    assert.equal(looksLikeProseStructuredQuestion(text), false);
  });

  test('ignores short clarifications', () => {
    assert.equal(looksLikeProseStructuredQuestion('Which file should I open?'), false);
  });

  test('ignores descriptive dash bullets with an echoed user question', () => {
    const text = `The user is asking what is this?
- Left side: Character sprites
- Middle sections: Various items and weapons
- Right side: More items and potions
This looks like a sprite sheet from a 2D pixel art game.`;

    assert.equal(looksLikeProseStructuredQuestion(text), false);
  });

  test('ignores numbered repo tours with a trailing open follow-up', () => {
    const text = `# Minnow repo tour

1. \`src/chat/\` — messaging, modes, prompts
2. \`src/tools/\` — tool definitions and loop
3. \`server.js\` — HTTP API for file/git tools

Want me to dive deeper into any of these?`;

    assert.equal(looksLikeProseStructuredQuestion(text), false);
  });

  test('still detects decision questions before numbered choices', () => {
    const text = `Which area should we explore first?

1. **Frontend** — Vite SPA
2. **Backend** — tool server
3. **Electron** — desktop shell`;

    assert.equal(looksLikeProseStructuredQuestion(text), true);
  });

  test('ignores informational numbered list with trailing open questions', () => {
    const text = `Here is what I found in the codebase:

1. \`src/chat/\` — messaging, modes, and prompts
2. \`src/tools/\` — tool definitions and the agent loop
3. \`server.js\` — HTTP API for file and git tools

Do you want me to go deeper on any of these? Should I start implementing changes?`;

    assert.equal(looksLikeProseStructuredQuestion(text), false);
  });

  test('ignores summary list when the choice question trails the bullets', () => {
    const text = `Summary of the main areas:

1. **Auth** — login and session handling
2. **Dashboard** — primary user interface

Which would you prefer to tackle first?`;

    assert.equal(looksLikeProseStructuredQuestion(text), false);
  });

  test('detects mode-handoff prose options after "Would you like" and I can', () => {
    const text = `This is a solid plan for a real-time PC monitoring app with Three.js visualization. It's well-structured across 4 waves:

Wave summary:

Wave 1: Project scaffold + Node.js backend (Express/WS + systeminformation)
Wave 2: Three.js scene + procedural models (case, components, GLTF infra)
Wave 3: Data binding to components + live UI overlay
Wave 4: Click interactions + polish

Would you like to start building this? I can:

Switch to Build mode to begin implementation
Or we can refine the plan first (e.g., add/remove features, adjust scope)`;

    assert.equal(looksLikeProseStructuredQuestion(text), true);
  });

  test('detects em-dash menu options after which would you like to do next', () => {
    const text = `Which would you like to do next?

Switch to Build — Start implementing the plan immediately.
Refine the plan — Address the minor gaps above before scaffolding.
Create an Orchestrate chat — Open a board and hand off the full plan for systematic execution.`;

    assert.equal(looksLikeProseStructuredQuestion(text), true);
  });

  test('detects question-style options after Would you like to colon lead-in', () => {
    const text = `What would you like to do next? Would you like to:

Switch to Build mode to start implementing this plan?
Create a new Orchestrate chat with this plan file for board-based execution?
Refine the plan or discuss any specific section?`;

    assert.equal(looksLikeProseStructuredQuestion(text), true);
  });

  test('detects question-style options after long plan review preamble', () => {
    const text = `What would you like to know about this plan? Here is my review.

Wave 1 covers scaffold. Wave 2 covers Three.js.

Key specs noted:
Local-first — offline capable
Temperature — color mapping for components

What would you like to do next? Would you like to:

Switch to Build mode to start implementing this plan?
Create a new Orchestrate chat with this plan file for board-based execution?
Refine the plan or discuss any specific section?`;

    assert.equal(looksLikeProseStructuredQuestion(text), true);
  });
});
