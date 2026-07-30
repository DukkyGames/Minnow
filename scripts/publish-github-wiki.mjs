import { readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(repositoryRoot, 'server', 'product-wiki', 'catalog.json');
const repositoryBlobBase = 'https://github.com/DukkyGames/Minnow/blob/main/';

/** Parse the optional staging output directory. */
function readOutputArgument() {
  const index = process.argv.indexOf('--output');
  if (index < 0) return path.join(os.tmpdir(), 'minnow-wiki-staging');
  const requested = process.argv[index + 1];
  if (!requested) throw new Error('--output requires a directory.');
  return path.resolve(requested);
}

/** Keep public user and developer docs while excluding operational runbooks. */
function shouldPublish(sourcePath) {
  if (sourcePath === 'documentation/README.md') return true;
  if (sourcePath === 'documentation/ROADMAP.md') return true;
  if (sourcePath === 'documentation/context.md') return true;
  return [
    'documentation/guides/',
    'documentation/plugins/',
    'documentation/agent-packs/',
    'documentation/design-system/',
  ].some((prefix) => sourcePath.startsWith(prefix));
}

/** Convert a canonical source path to a stable flat GitHub Wiki filename. */
function wikiFilename(sourcePath) {
  if (sourcePath === 'documentation/README.md') return '_Home.md';
  if (sourcePath === 'documentation/ROADMAP.md') return 'Roadmap.md';
  if (sourcePath === 'documentation/context.md') return 'Developer-Reference.md';
  const relative = sourcePath.replace(/^documentation\//u, '').replace(/\.md$/u, '');
  const words = relative
    .split('/')
    .flatMap((segment) => segment.split('-'))
    .filter((word) => word && word.toLocaleLowerCase() !== 'readme')
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1));
  return `${words.join('-') || 'Documentation'}.md`;
}

/** Resolve one Markdown target to a repository-root path. */
function resolveSourceLink(sourcePath, href) {
  if (/^(https?:|mailto:|#)/iu.test(href)) return null;
  const [target, anchor = ''] = href.split('#', 2);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), target));
  return { path: resolved, anchor: anchor ? `#${anchor}` : '' };
}

/** Rewrite links for GitHub Wiki's flat generated namespace. */
function rewriteLinks(markdown, sourcePath, filenameBySource) {
  return markdown.replace(/(!?\[[^\]]*\])\(([^)\s]+)(?:\s+"[^"]*")?\)/gu, (match, label, href) => {
    const resolved = resolveSourceLink(sourcePath, href);
    if (!resolved) return match;
    const wikiTarget = filenameBySource.get(resolved.path);
    if (wikiTarget) {
      return `${label}(${wikiTarget.replace(/\.md$/u, '')}${resolved.anchor})`;
    }
    return `${label}(${repositoryBlobBase}${resolved.path}${resolved.anchor})`;
  });
}

/** Clear generated staging files while preserving a cloned wiki's .git directory. */
async function clearOutputDirectory(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const rows = await readdir(outputDirectory, { withFileTypes: true });
  for (const row of rows) {
    if (row.name === '.git') continue;
    await rm(path.join(outputDirectory, row.name), { recursive: true, force: true });
  }
}

/** Generate navigation from catalog section order. */
function buildSidebar(entries, filenameBySource) {
  const sections = new Map();
  for (const entry of entries) {
    const rows = sections.get(entry.section) ?? [];
    rows.push(entry);
    sections.set(entry.section, rows);
  }
  const lines = ['# Minnow wiki', '', '- [Home](Home)', '- [Roadmap](Roadmap)'];
  for (const [section, rows] of sections) {
    const visible = rows.filter((entry) =>
      entry.path !== 'documentation/README.md'
      && entry.path !== 'documentation/ROADMAP.md'
    );
    if (!visible.length) continue;
    lines.push('', `**${section}**`);
    for (const entry of visible) {
      const filename = filenameBySource.get(entry.path);
      lines.push(`- [${entry.title}](${filename.replace(/\.md$/u, '')})`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Stage the generated GitHub Wiki mirror. */
async function main() {
  const outputDirectory = readOutputArgument();
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const entries = catalog.entries.filter((entry) => shouldPublish(entry.path));
  const filenameBySource = new Map(entries.map((entry) => [entry.path, wikiFilename(entry.path)]));
  await clearOutputDirectory(outputDirectory);

  for (const entry of entries) {
    const source = await readFile(path.join(repositoryRoot, entry.path), 'utf8');
    const rewritten = rewriteLinks(source, entry.path, filenameBySource);
    const preface = entry.path === 'documentation/README.md'
      ? '> This wiki is generated from the Minnow repository. Use the in-app **?** button for help that matches your installed version.\n\n'
      : '';
    await writeFile(
      path.join(outputDirectory, filenameBySource.get(entry.path)),
      `${preface}${rewritten.trim()}\n`,
      'utf8',
    );
  }

  await writeFile(
    path.join(outputDirectory, '_Sidebar.md'),
    buildSidebar(entries, filenameBySource),
    'utf8',
  );
  await writeFile(
    path.join(outputDirectory, '_Footer.md'),
    'Generated from [`documentation/`](https://github.com/DukkyGames/Minnow/tree/main/documentation). Do not edit generated pages directly.\n',
    'utf8',
  );
  console.log(`Staged ${entries.length} wiki pages in ${outputDirectory}.`);
}

await main();
