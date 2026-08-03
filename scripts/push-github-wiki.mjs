/**
 * Stage documentation and push to the GitHub Wiki git repository.
 * Requires a one-time "Home" page created in the GitHub UI so Minnow.wiki.git exists.
 */
import { execFileSync, execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wikiRemote = 'https://github.com/HenriGrimm/Minnow.wiki.git';

/** Resolve a token for wiki git HTTPS (WIKI_SYNC_TOKEN or `gh auth token`). */
function resolveWikiToken() {
  if (process.env.WIKI_SYNC_TOKEN?.trim()) return process.env.WIKI_SYNC_TOKEN.trim();
  try {
    return execSync('gh auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error('Set WIKI_SYNC_TOKEN or run `gh auth login` before publishing the wiki.');
  }
}

/** Run a git command and return stdout. */
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function main() {
  const token = resolveWikiToken();
  const authenticatedRemote = wikiRemote.replace(
    'https://',
    `https://x-access-token:${token}@`,
  );
  const workDir = path.join(os.tmpdir(), `minnow-wiki-push-${Date.now()}`);

  execSync('node scripts/generate-product-wiki-catalog.mjs', { cwd: repositoryRoot, stdio: 'inherit' });

  try {
    git(repositoryRoot, ['clone', authenticatedRemote, workDir]);
  } catch {
    console.error(`
Could not clone ${wikiRemote}.

GitHub does not create the wiki git repository until the first page exists.

One-time setup:
  1. Open https://github.com/HenriGrimm/Minnow/wiki/_new
  2. Title: Home — body: anything (the sync replaces it)
  3. Click "Save page"
  4. Re-run: npm run wiki:publish
`);
    process.exit(1);
  }

  execSync(`node scripts/publish-github-wiki.mjs --output ${JSON.stringify(workDir)}`, {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });

  git(workDir, ['config', 'user.name', 'Minnow Wiki Sync']);
  git(workDir, ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  git(workDir, ['add', '--all']);

  const hasChanges = (() => {
    try {
      execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: workDir, stdio: 'ignore' });
      return false;
    } catch {
      return true;
    }
  })();

  if (!hasChanges) {
    console.log('Wiki is already current.');
    return;
  }

  git(workDir, ['commit', '-m', '📚 Sync Minnow documentation']);
  git(workDir, ['push', 'origin', 'HEAD:master']);
  console.log(`Published wiki from ${workDir}`);
}

main();
