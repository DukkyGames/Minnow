import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const pageTs = readFileSync(join(root, 'src/ui/global-bugs-page.ts'), 'utf8');
const pageCss = readFileSync(join(root, 'src/styles/global-bugs-page.css'), 'utf8');
const benchmarkTs = readFileSync(join(root, 'src/ui/benchmark-page.ts'), 'utf8');

describe('global bugs page (POLISH-015)', () => {
  test('globalBugsView exists and sits after topbar before appBody', () => {
    const topbarEnd = html.indexOf('</header>');
    const bugs = html.indexOf('id="globalBugsView"');
    const app = html.indexOf('id="appBody"');
    assert.ok(topbarEnd > 0 && bugs > topbarEnd && app > bugs);
  });

  test('openGlobalBugs does not hide header.topbar', () => {
    const openBlock = pageTs.slice(
      pageTs.indexOf('export function openGlobalBugs'),
      pageTs.indexOf('function onFilterChange'),
    );
    assert.doesNotMatch(openBlock, /header\.topbar[\s\S]*classList\.(add|remove)\('hidden'\)/);
    assert.doesNotMatch(openBlock, /querySelector\('header\.topbar'\)/);
  });

  test('closeGlobalBugs does not toggle header.topbar', () => {
    const closeBlock = pageTs.slice(
      pageTs.indexOf('export function closeGlobalBugs'),
      pageTs.indexOf('export function openGlobalBugs'),
    );
    assert.doesNotMatch(closeBlock, /header\.topbar/);
  });

  test('global-bugs-page fills flex area below topbar (not 100vh)', () => {
    const rootRule = pageCss.match(/\.global-bugs-page\s*\{[^}]+\}/s)?.[0] ?? '';
    assert.match(rootRule, /flex:\s*1/);
    assert.match(rootRule, /min-height:\s*0/);
    assert.doesNotMatch(rootRule, /height:\s*100vh/);
  });

  test('openBenchmark closes global bugs when open', () => {
    const openBlock = benchmarkTs.slice(
      benchmarkTs.indexOf('export function openBenchmark'),
      benchmarkTs.indexOf('export function closeBenchmark'),
    );
    assert.match(openBlock, /isGlobalBugsPageOpen\(\)/);
    assert.match(openBlock, /closeGlobalBugs\(\)/);
  });

  test('refreshGlobalBugsSidebarBadge waits for bugs store hydration', () => {
    const badgeBlock = pageTs.slice(pageTs.indexOf('export function refreshGlobalBugsSidebarBadge'));
    assert.match(badgeBlock, /isBugsStoreLoaded\(\)/);
  });
});
