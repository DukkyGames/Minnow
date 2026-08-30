#!/usr/bin/env node
/**
 * P2-A — convert the mapped runner closure to `server/runner/*.js` + `.d.ts`.
 *
 * One-shot extract (not a production build step). The server still ships the
 * resulting plain JS; this script is how the TS sources were moved.
 *
 * Usage:
 *   node scripts/extract-runner-modules.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { SLICE_SOURCES, mapRunnerImports, resolveSpecifier } from './map-runner-imports.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'server', 'runner');

/** Already exist as dual-environment JS under `server/` — import those, do not fork. */
const SERVER_EQUIVALENT = {
  'src/providers/sanitize-completion-body.ts': '../providers/sanitize-completion-body.js',
  'src/providers/provider-host.ts': '../providers/provider-host.js',
  'src/providers/resolve-model-api.ts': '../generations/resolve-model-api.js',
  'src/lib/resolve-model-api.mjs': '../generations/resolve-model-api.js',
  'src/providers/types.ts': './provider-ids.js',
};

const SKIP = new Set([
  ...Object.keys(SERVER_EQUIVALENT),
  'src/lib/anthropic-thinking-style.mjs',
  'src/lib/anthropic-thinking-style.ts',
]);

function destName(rel) {
  if (rel === 'src/chat/orchestrate/stats-math.ts') return 'stats-math.js';
  return path.basename(rel).replace(/\.tsx?$/, '.js').replace(/\.mjs$/, '.js');
}

function posixRel(abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

function preprocess(rel, source) {
  let next = source;
  if (rel === 'src/agents/merge-thinking-body.ts') {
    next = next.replace(/import \{ setStatus \} from '\.\.\/ui\/status';\r?\n/, '');
    next = next.replace(
      /setStatus\('ok', patch\.hint\.message\);/,
      'options?.onStatusHint?.(patch.hint.message);',
    );
    next = next.replace(
      /llamaSupportsThinkingBudget\?: boolean;/,
      'llamaSupportsThinkingBudget?: boolean;\n    /** Toast hook — renderer passes setStatus; the package stays DOM-free. */\n    onStatusHint?: (message: string) => void;',
    );
  }
  if (rel === 'src/providers/constrained-tool-calls.ts') {
    next = next.replace(
      /\/\*\* Dev-only logging when localStorage\.minnowDebugConstrained is set\. \*\/\r?\nexport function logConstrainedDebug\(event: string, detail\?: Record<string, unknown>\): void \{\r?\n  try \{\r?\n    if \(localStorage\.getItem\('minnowDebugConstrained'\) !== '1'\) return;\r?\n  \} catch \{\r?\n    return;\r?\n  \}\r?\n  console\.info\('\[constrained\]', event, detail \?\? ''\);\r?\n\}/,
      `/** Debug hook — renderer may wrap; the shared package never reads host storage. */\nexport function logConstrainedDebug(event: string, detail?: Record<string, unknown>): void {\n  void event;\n  void detail;\n}`,
    );
  }
  if (rel === 'src/tools/turn-continuation.ts') {
    next = next.replace(
      /\/\*\* True when dev turn logging is enabled \(`localStorage\.minnowDebugTurns === '1'`\)\. \*\/\r?\nexport function isTurnDebugEnabled\(\): boolean \{[\s\S]*?\n\}/,
      `/** Shared package default: off. The renderer wrapper may read host storage. */\nexport function isTurnDebugEnabled(): boolean {\n  return false;\n}`,
    );
  }
  return next;
}

function rewriteSpecifier(fromAbs, specifier, pathMap) {
  if (!specifier.startsWith('.')) return specifier;
  const resolved = resolveSpecifier(fromAbs, specifier);
  if (!resolved) return specifier;
  if (SERVER_EQUIVALENT[resolved]) return SERVER_EQUIVALENT[resolved];
  if (pathMap.has(resolved)) return './' + pathMap.get(resolved);
  if (resolved.startsWith('src/')) {
    // Type-only leftovers that survived transpile — point at the original.
    const fromDest = path.join(OUT_DIR, 'dummy.js');
    const target = path.join(ROOT, resolved);
    let rel = path.relative(path.dirname(fromDest), target).split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = './' + rel;
    return rel;
  }
  return specifier;
}

function rewriteImports(js, fromAbs, pathMap) {
  return js.replace(
    /\b(import|export)(\s+[\s\S]*?\s+from\s*)(['"])([^'"]+)\3/g,
    (full, kw, mid, q, spec) => `${kw}${mid}${q}${rewriteSpecifier(fromAbs, spec, pathMap)}${q}`,
  ).replace(
    /\bimport\s*(['"])([^'"]+)\1/g,
    (full, q, spec) => `import ${q}${rewriteSpecifier(fromAbs, spec, pathMap)}${q}`,
  );
}

function srcReexportPath(srcRel, destJs) {
  const fromDir = path.dirname(path.join(ROOT, srcRel));
  const target = path.join(OUT_DIR, destJs);
  let rel = path.relative(fromDir, target).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

async function main() {
  const map = mapRunnerImports();
  /** @type {Map<string, string>} */
  const pathMap = new Map();
  const toMove = map.runtimeClosure.filter((rel) => !SKIP.has(rel) && !SLICE_SOURCES.includes(rel));
  for (const rel of toMove) {
    pathMap.set(rel, destName(rel));
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const dtsInclude = [];
  for (const rel of toMove) {
    const abs = path.join(ROOT, rel);
    const source = preprocess(rel, fs.readFileSync(abs, 'utf8'));
    const transpiled = await esbuild.transform(source, {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
      sourcefile: abs,
    });
    let js = rewriteImports(transpiled.code, abs, pathMap);
    // Ban leftover .ts extensions in emitted JS.
    js = js.replace(/from\s*(['"])(\.[^'"]+)\.ts\1/g, 'from $1$2.js$1');
    const outJs = path.join(OUT_DIR, pathMap.get(rel));
    fs.writeFileSync(outJs, js);
    dtsInclude.push(rel);
    console.log(`wrote ${posixRel(outJs)}`);
  }

  const dtsTsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      declaration: true,
      emitDeclarationOnly: true,
      isolatedModules: true,
      skipLibCheck: true,
      strict: false,
      allowImportingTsExtensions: true,
      noEmit: false,
      rootDir: 'src',
      outDir: 'tmp-runner-dts',
    },
    include: dtsInclude,
  };
  const cfgPath = path.join(ROOT, 'tmp-runner-tsconfig.json');
  fs.writeFileSync(cfgPath, JSON.stringify(dtsTsconfig, null, 2));
  const tsc = spawnSync('npx', ['tsc', '-p', cfgPath], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (tsc.status !== 0) {
    console.warn('tsc declaration emit reported errors; copying whatever was produced');
  }

  for (const rel of toMove) {
    const destJs = pathMap.get(rel);
    const dtsRel = rel.replace(/^src\//, '').replace(/\.tsx?$/, '.d.ts');
    const emitted = path.join(ROOT, 'tmp-runner-dts', dtsRel);
    if (!fs.existsSync(emitted)) {
      console.warn(`missing d.ts for ${rel} (looked for ${dtsRel})`);
      continue;
    }
    let dts = fs.readFileSync(emitted, 'utf8');
    dts = dts.replace(
      /\bfrom\s*(['"])([^'"]+)\1/g,
      (full, q, spec) => `${'from '}${q}${rewriteSpecifier(path.join(ROOT, rel), spec, pathMap)}${q}`,
    );
    dts = dts.replace(/from\s*(['"])(\.[^'"]+)\.ts\1/g, 'from $1$2.js$1');
    fs.writeFileSync(path.join(OUT_DIR, destJs.replace(/\.js$/, '.d.ts')), dts);
  }

  for (const rel of toMove) {
    if (rel === 'src/agents/sub-agent-runner.ts') continue;
    const destJs = pathMap.get(rel);
    const reexport = srcReexportPath(rel, destJs);
    if (rel === 'src/agents/merge-thinking-body.ts') {
      const extra = `import { setStatus } from '../ui/status';
import {
  mergeThinkingIntoCompletionBody as mergeThinkingIntoCompletionBodyShared,
  applyUtilityThinkingOff,
  type MergeThinkingResult,
} from '${reexport}';

export { applyUtilityThinkingOff };
export type { MergeThinkingResult };

/** Restore the LM Studio toast that the shared package cannot own. */
export function mergeThinkingIntoCompletionBody<T extends Record<string, unknown>>(
  ...args: Parameters<typeof mergeThinkingIntoCompletionBodyShared<T>>
): ReturnType<typeof mergeThinkingIntoCompletionBodyShared<T>> {
  const [body, resolved, provider, modelCapabilities, options] = args;
  return mergeThinkingIntoCompletionBodyShared(body, resolved, provider, modelCapabilities, {
    ...options,
    onStatusHint: (message) => setStatus('ok', message),
  });
}
`;
      fs.writeFileSync(path.join(ROOT, rel), extra);
      continue;
    }
    fs.writeFileSync(
      path.join(ROOT, rel),
      `/** Re-export of the shared runner package (MIN-698). */\nexport * from '${reexport}';\n`,
    );
  }

  fs.rmSync(path.join(ROOT, 'tmp-runner-dts'), { recursive: true, force: true });
  fs.rmSync(cfgPath, { force: true });
  console.log(`extracted ${toMove.length} modules → server/runner/`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => {
  console.error(err);
  process.exit(1);
});
