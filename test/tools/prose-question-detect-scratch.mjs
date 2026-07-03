import assert from 'node:assert/strict';
import { looksLikeProseStructuredQuestion } from '../../src/tools/prose-question-detect.ts';

const variants = [
  {
    name: 'plain questions',
    text: `What would you like to do next? Would you like to:

Switch to Build mode to start implementing this plan?
Create a new Orchestrate chat with this plan file for board-based execution?
Refine the plan or discuss any specific section?`,
  },
  {
    name: 'dash bullets',
    text: `What would you like to do next? Would you like to:

- Switch to Build mode to start implementing this plan?
- Create a new Orchestrate chat with this plan file for board-based execution?
- Refine the plan or discuss any specific section?`,
  },
  {
    name: 'numbered',
    text: `What would you like to do next? Would you like to:

1. Switch to Build mode to start implementing this plan?
2. Create a new Orchestrate chat with this plan file for board-based execution?
3. Refine the plan or discuss any specific section?`,
  },
  {
    name: 'early would you like rhetorical',
    text: `What would you like to know about this plan? Here is my review.

Wave 1 covers scaffold. Wave 2 covers Three.js.

What would you like to do next? Would you like to:

Switch to Build mode to start implementing this plan?
Create a new Orchestrate chat with this plan file for board-based execution?
Refine the plan or discuss any specific section?`,
  },
];

for (const v of variants) {
  const r = looksLikeProseStructuredQuestion(v.text);
  console.log(v.name, r);
  if (!r) process.exitCode = 1;
}
