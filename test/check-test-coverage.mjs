#!/usr/bin/env node
/**
 * Fail when any test file matching *.test.{js,mjs,mts,ts} is not covered by discovery rules.
 * Used in CI to prevent silent test-debt (files that never run in npm test).
 */

import process from 'node:process';
import { discoverTestFiles, findOrphanTests } from './test-discovery.mjs';
import { EXCLUDED_TESTS } from './test-config.mjs';

function main() {
  const all = discoverTestFiles();
  const { orphans, unknownExt } = findOrphanTests();

  if (orphans.length === 0 && unknownExt.length === 0) {
    const excluded = EXCLUDED_TESTS.length;
    console.log(
      `test coverage OK: ${all.length} files on disk, ${all.length - excluded} in npm test, ${excluded} excluded`,
    );
    process.exit(0);
  }

  if (unknownExt.length > 0) {
    console.error('Test files with unrecognized extensions (add a runner rule or rename):');
    for (const file of unknownExt) console.error(`  ${file}`);
  }

  if (orphans.length > 0) {
    console.error('Orphan test files (not covered by test discovery — they will not run in npm test):');
    for (const file of orphans) console.error(`  ${file}`);
    console.error('\nFix: add a path rule in test/test-config.mjs or adjust DEFAULT_RUNNER_BY_EXT.');
  }

  process.exit(1);
}

main();
