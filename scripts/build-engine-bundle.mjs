#!/usr/bin/env node
/**
 * esbuild bundle for the Session Engine (MIN-354 Stage 3).
 *
 * Bundles src/session-engine/engine-bundle-entry.ts into a single ESM file
 * that runs under plain Node (no tsx, no --import hooks needed).
 *
 * Run:  node scripts/build-engine-bundle.mjs
 * Also called by:  scripts/build-electron.mjs  (after tsc)
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/** Output path — also exported so build-electron.mjs can reference it. */
export const ENGINE_BUNDLE_OUTFILE = path.join(
  REPO_ROOT,
  'server',
  'session',
  'engine-bundle',
  'engine-bundle.mjs',
);

/** Output directory. */
const OUTDIR = path.dirname(ENGINE_BUNDLE_OUTFILE);

/** Path to the single esbuild entry point. */
const ENTRY = path.join(REPO_ROOT, 'src', 'session-engine', 'engine-bundle-entry.ts');

// ---------------------------------------------------------------------------
// Plugin A — asset stubs: *.css → export default {}  /  *.css?url → stub.css
// ---------------------------------------------------------------------------
const assetStubsPlugin = {
  name: 'asset-stubs',
  /** @param {import('esbuild').PluginBuild} build */
  setup(build) {
    // Plain .css imports
    build.onLoad({ filter: /\.css$/ }, () => ({
      contents: 'export default {};',
      loader: 'js',
    }));
    // ?url variants (resolve before other plugins see them)
    build.onResolve({ filter: /\.css\?url$/ }, (args) => ({
      path: args.path,
      namespace: 'css-url-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'css-url-stub' }, () => ({
      contents: 'export default "/stub.css";',
      loader: 'js',
    }));
  },
};

// ---------------------------------------------------------------------------
// Plugin B — browser-only stubs (CommonJS Proxy — named ESM imports fail)
// ---------------------------------------------------------------------------

/** Packages that must never run in the Session Engine Node context. */
const BROWSER_ONLY_PREFIXES = ['@codemirror/', '@lezer/', '@xterm/'];
const BROWSER_ONLY_EXACT = new Set(['d3-drag', 'd3-force', 'd3-selection', 'd3-zoom']);

function isBrowserOnlyPackage(name) {
  for (const prefix of BROWSER_ONLY_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  return BROWSER_ONLY_EXACT.has(name);
}

/**
 * CJS proxy stub: any access throws a meaningful error at runtime.
 * We use CJS (not ESM) because an ESM stub with `export default proxy` does
 * not satisfy named imports like `import { EditorView } from "@codemirror/view"`.
 * @param {string} pkg
 */
function browserOnlyStub(pkg) {
  const msg = `BROWSER_ONLY: ${pkg} is not available in the Session Engine bundle`;
  return `
module.exports = new Proxy(function(){}, {
  get() { throw new Error(${JSON.stringify(msg)}); },
  apply() { throw new Error(${JSON.stringify(msg)}); },
  construct() { throw new Error(${JSON.stringify(msg)}); },
});
`.trim();
}

const browserOnlyStubsPlugin = {
  name: 'browser-only-stubs',
  /** @param {import('esbuild').PluginBuild} build */
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      // Only intercept bare package imports (not relative / absolute paths).
      if (args.path.startsWith('.') || path.isAbsolute(args.path)) return undefined;
      if (!isBrowserOnlyPackage(args.path)) return undefined;
      return { path: args.path, namespace: 'browser-only-stub' };
    });
    build.onLoad({ filter: /.*/, namespace: 'browser-only-stub' }, (args) => ({
      contents: browserOnlyStub(args.path),
      loader: 'js',
    }));
  },
};

// ---------------------------------------------------------------------------
// Plugin C — server externals: relative imports that resolve under server/
//
// When a bundled src/ module imports something like
//   ../../server/session/engine-api.js
// that file must NOT be inlined (it owns shared server state). We detect these
// by resolving them against args.resolveDir and checking if the result falls
// under REPO_ROOT/server/. We then re-emit the path RELATIVE TO THE OUTDIR
// so that the bundle can find it at runtime without climbing past the server/.
// ---------------------------------------------------------------------------

const serverExternalsPlugin = {
  name: 'server-externals',
  /** @param {import('esbuild').PluginBuild} build */
  setup(build) {
    build.onResolve({ filter: /^\.\.?\//, namespace: 'file' }, async (args) => {
      const resolved = path.resolve(args.resolveDir, args.path);
      const serverRoot = path.join(REPO_ROOT, 'server');

      if (!resolved.startsWith(serverRoot + path.sep) && resolved !== serverRoot) {
        return undefined; // not a server file — let esbuild handle normally
      }

      // Re-express path relative to the OUTPUT DIR, not the source file.
      // e.g. server/session/engine-api.js → ../engine-api.js (from engine-bundle/)
      const relFromOutdir = path.relative(OUTDIR, resolved).replace(/\\/g, '/');
      const spec = relFromOutdir.startsWith('.') ? relFromOutdir : `./${relFromOutdir}`;

      return { path: spec, external: true };
    });
  },
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/** @returns {Promise<void>} */
export async function buildEngineBundle() {
  // Import esbuild at call time so this module can be imported without esbuild installed.
  const _require = createRequire(import.meta.url);
  const esbuild = /** @type {import('esbuild')} */ (_require('esbuild'));

  fs.mkdirSync(OUTDIR, { recursive: true });

  const result = await esbuild.build({
    entryPoints: [ENTRY],
    outfile: ENGINE_BUNDLE_OUTFILE,
    bundle: true,
    splitting: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    packages: 'external',
    sourcemap: 'linked',
    minify: false,
    metafile: true,
    plugins: [assetStubsPlugin, browserOnlyStubsPlugin, serverExternalsPlugin],
  });

  // ---------------------------------------------------------------------------
  // Post-build assertions
  // ---------------------------------------------------------------------------

  // 1. Zero errors and warnings from esbuild.
  if (result.errors.length > 0) {
    throw new Error(
      `[engine-bundle] esbuild errors:\n${result.errors.map((e) => e.text).join('\n')}`,
    );
  }
  if (result.warnings.length > 0) {
    throw new Error(
      `[engine-bundle] esbuild warnings:\n${result.warnings.map((w) => w.text).join('\n')}`,
    );
  }

  const bundleText = fs.readFileSync(ENGINE_BUNDLE_OUTFILE, 'utf8');

  // 2. No "../../server/"-style absolute-wrong relative specs survived the server-externals rewrite.
  //    The rewrite should have turned them into `../foo.js` (one level up from engine-bundle/).
  const badServerSpecRe = /from\s+['"](\.\.\/)+server\//g;
  if (badServerSpecRe.test(bundleText)) {
    throw new Error(
      '[engine-bundle] bundle still contains wrong ../server/ specifiers after server-externals rewrite',
    );
  }

  // 3. Every relative external (ending in .js) resolves to a real file from outdir.
  const relExternalRe = /from\s+['"](\.[^'"]+\.(?:js|mjs|cjs))['"]/g;
  let m;
  while ((m = relExternalRe.exec(bundleText)) !== null) {
    const spec = m[1];
    const resolved = path.resolve(OUTDIR, spec);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `[engine-bundle] relative external '${spec}' does not exist at ${resolved}`,
      );
    }
  }

  // 4. Top-level package imports allowlist (non-node: bare imports).
  //    Allowed: diff, dompurify, highlight.js, marked, cron-parser. node:* builtins all OK.
  const ALLOWED_PACKAGES = new Set(['diff', 'dompurify', 'highlight.js', 'marked', 'cron-parser']);
  // Match bare package imports (not starting with . or /)
  const bareImportRe = /^import\s+.*?\s+from\s+['"]([^./][^'"]*)['"]/gm;
  const dynamicImportRe = /\bimport\s*\(\s*['"]([^./][^'"]*)['"]\s*\)/g;
  const barePackages = new Set();
  for (const re of [bareImportRe, dynamicImportRe]) {
    let match;
    while ((match = re.exec(bundleText)) !== null) {
      barePackages.add(match[1]);
    }
  }
  for (const pkg of barePackages) {
    if (pkg.startsWith('node:')) continue; // node: builtins always allowed
    if (ALLOWED_PACKAGES.has(pkg)) continue;
    throw new Error(
      `[engine-bundle] unexpected bare package import '${pkg}' — add to ALLOWED_PACKAGES if intentional`,
    );
  }

  // 5. No import.meta.glob() and no bare import.meta.url in bundle output.
  if (/import\.meta\.glob\s*\(/.test(bundleText)) {
    throw new Error('[engine-bundle] bundle contains import.meta.glob() — Vite-only API');
  }
  if (/import\.meta\.url/.test(bundleText)) {
    throw new Error('[engine-bundle] bundle contains import.meta.url — must be removed before packaging');
  }

  // 6. Smoke-import: spawn a plain node process to verify the bundle's exports are functions.
  //    No server/* is statically imported by the bundle, so sqlite is not initialised.
  //    Force exit after assertions since some bundled module-level code may create timers.
  const smokeCode = `
import { pathToFileURL } from 'node:url';
const mod = await import(pathToFileURL(${JSON.stringify(ENGINE_BUNDLE_OUTFILE)}).href);
const fns = ['runEngineMainChatTurn','resumeEngineBoardsOnBoot','applyBoardCommand',
  'bootEngineControllerOnStart','parkAskQuestion','buildEngineApiMessages'];
for (const fn of fns) {
  if (typeof mod[fn] !== 'function') throw new Error('expected function: ' + fn + ', got ' + typeof mod[fn]);
}
console.log('engine-bundle-smoke-ok');
process.exit(0);
`.trim();

  const smokeResult = spawnSync(process.execPath, ['--input-type=module', '-e', smokeCode], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, MINNOW_TEST: '1' },
    timeout: 30000,
  });
  if (smokeResult.status !== 0) {
    throw new Error(
      `[engine-bundle] smoke-import failed (exit ${smokeResult.status}):\n${smokeResult.stdout}\n${smokeResult.stderr}`,
    );
  }
  if (!smokeResult.stdout.includes('engine-bundle-smoke-ok')) {
    throw new Error(`[engine-bundle] smoke-import produced unexpected output:\n${smokeResult.stdout}`);
  }

  const stat = fs.statSync(ENGINE_BUNDLE_OUTFILE);
  console.log(
    `[engine-bundle] OK — ${(stat.size / 1024 / 1024).toFixed(2)} MB → ${ENGINE_BUNDLE_OUTFILE}`,
  );
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  buildEngineBundle().catch((err) => {
    console.error('[engine-bundle]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
