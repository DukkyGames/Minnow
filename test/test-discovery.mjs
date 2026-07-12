/**
 * Discover test files, assign runners, and group files for batched execution.
 */

import { globSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_RUNNER_BY_EXT,
  EXCLUDED_TESTS,
  PATH_RUNNER_RULES,
  RUNNERS,
  SCOPED_SUITES,
  TEST_FILE_GLOB,
} from './test-config.mjs';

const excludedPaths = new Set(
  EXCLUDED_TESTS.map((entry) => normalizePath(entry.path)),
);

/** Normalize to forward-slash paths for stable comparisons. */
export function normalizePath(filePath) {
  return String(filePath).replace(/\\/g, '/');
}

/** Cache glob expansions for path rules and suite patterns. */
const patternCache = new Map();

function expandPattern(pattern) {
  const key = normalizePath(pattern);
  if (!patternCache.has(key)) {
    const matches = globSync(key, { cwd: process.cwd() });
    patternCache.set(key, new Set(matches.map(normalizePath)));
  }
  return patternCache.get(key);
}

function matchesPattern(filePath, pattern) {
  return expandPattern(pattern).has(normalizePath(filePath));
}

function extensionOf(filePath) {
  const base = path.basename(filePath);
  for (const ext of ['.test.mjs', '.test.mts', '.test.js', '.test.ts']) {
    if (base.endsWith(ext)) return ext;
  }
  return null;
}

/** Resolve the runner id for a single test file. */
export function resolveRunner(filePath) {
  const normalized = normalizePath(filePath);
  for (const rule of PATH_RUNNER_RULES) {
    if (matchesPattern(normalized, rule.pattern)) {
      return rule.runner;
    }
  }
  const ext = extensionOf(normalized);
  if (!ext) return null;
  return DEFAULT_RUNNER_BY_EXT[ext] ?? null;
}

/** List every discoverable test file on disk. */
export function discoverTestFiles() {
  return globSync(TEST_FILE_GLOB, { cwd: process.cwd() })
    .map(normalizePath)
    .sort();
}

/**
 * Return test files for a scoped suite name, or all non-excluded tests when suite is null.
 * @param {string | null} suiteName
 */
export function listTestsForSuite(suiteName) {
  const all = discoverTestFiles().filter((file) => !excludedPaths.has(file));

  if (!suiteName) return all;

  const suite = SCOPED_SUITES[suiteName];
  if (!suite) {
    throw new Error(`Unknown test suite "${suiteName}". Known: ${Object.keys(SCOPED_SUITES).join(', ')}`);
  }

  return all.filter((file) => suite.patterns.some((pattern) => matchesPattern(file, pattern)));
}

/**
 * Group test files by runner id for batched subprocess invocation.
 * @param {string[]} files
 * @returns {Map<string, string[]>}
 */
export function groupByRunner(files) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const file of files) {
    const runner = resolveRunner(file);
    if (!runner) continue;
    if (!groups.has(runner)) groups.set(runner, []);
    groups.get(runner).push(file);
  }
  for (const list of groups.values()) list.sort();
  return groups;
}

/**
 * Find test files that are not excluded and have no runner assignment.
 * @returns {{ orphans: string[], unknownExt: string[] }}
 */
export function findOrphanTests() {
  const orphans = [];
  const unknownExt = [];

  for (const file of discoverTestFiles()) {
    if (excludedPaths.has(file)) continue;
    const ext = extensionOf(file);
    if (!ext) {
      unknownExt.push(file);
      continue;
    }
    if (!resolveRunner(file)) {
      orphans.push(file);
    }
  }

  return { orphans, unknownExt };
}

/** Post commands for a scoped suite (smoke scripts, etc.). */
export function suitePostCommands(suiteName) {
  if (!suiteName) return [];
  const suite = SCOPED_SUITES[suiteName];
  return suite?.post ?? [];
}

export { RUNNERS, SCOPED_SUITES, EXCLUDED_TESTS };
