#!/usr/bin/env node

/**
 * V1 JSONL invariant checker — retired (MIN-713 deleted board-log-invariants).
 * V2 board history is the journal under ~/.minnow/boards/<id>/.
 */

import { CHECK_LOG_RETIRED_ERROR } from '../server/orchestrate/board-testing/constants.js';

function printHelp() {
  console.log(`Usage: npm run check:board-log

${CHECK_LOG_RETIRED_ERROR}
`);
}

printHelp();
process.exit(1);
