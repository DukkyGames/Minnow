import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

/**
 * Vite injects the module script before extracted CSS in `index.html`, so JS can run
 * before the stylesheet finishes loading. Hoist bundle `<link rel="stylesheet">` tags
 * ahead of the entry `<script type="module">` in `<head>` so CSS starts earlier.
 */
/** Strip .eot / .woff from Uicons @font-face — Chromium only fetches .woff2. */
function uiconsWoff2OnlyPlugin(): Plugin {
  function stripNonWoff2Src(css: string): string {
    return css
      .replace(/,url\([^)]+\)\s*format\(["']woff["']\)/g, '')
      .replace(/,url\([^)]+\)\s*format\(["']embedded-opentype["']\)/g, '');
  }

  return {
    name: 'minnow-uicons-woff2-only',
    transform(code, id) {
      if (!id.endsWith('.css')) return null;
      if (!code.includes('uicons-regular-rounded') && !code.includes('uicons-solid-rounded')) {
        return null;
      }
      const trimmed = stripNonWoff2Src(code);
      return trimmed === code ? null : { code: trimmed, map: null };
    },
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (/\.(woff|eot)(\?|$)/i.test(fileName) && /uicons/i.test(fileName)) {
          delete bundle[fileName];
        }
      }
    },
  };
}

function cssBeforeEntryScriptPlugin(): Plugin {
  return {
    name: 'minnow-css-before-entry-script',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const linkTags = html.match(/<link rel="stylesheet"[^>]*>/g);
        if (!linkTags?.length) return html;

        let out = html;
        for (const tag of linkTags) {
          out = out.replace(tag, '');
        }
        const insertion = linkTags
          .map((tag) => {
            const href = tag.match(/href="([^"]+)"/)?.[1];
            if (!href) return tag;
            const cross = tag.includes('crossorigin') ? ' crossorigin' : '';
            return `<link rel="preload" as="style" href="${href}"${cross}>\n  ${tag}`;
          })
          .join('\n  ');
        return out.replace(
          /(<script type="module"[^>]*><\/script>)/,
          `${insertion}\n  $1`,
        );
      },
    },
  };
}

/**
 * CodeMirror language-data pre-bundles into many hashed `dist-*.js` chunks under
 * `node_modules/.vite/deps`. Pre-include editor deps and crawl editor entries so
 * cold start finishes before clients request stale chunk URLs.
 */
const CODE_MIRROR_OPTIMIZE_INCLUDE = [
  '@codemirror/language-data',
  '@codemirror/language',
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/autocomplete',
  '@codemirror/commands',
  '@codemirror/lint',
  '@codemirror/search',
  '@codemirror/lang-angular',
  '@codemirror/lang-cpp',
  '@codemirror/lang-css',
  '@codemirror/lang-go',
  '@codemirror/lang-html',
  '@codemirror/lang-java',
  '@codemirror/lang-javascript',
  '@codemirror/lang-json',
  '@codemirror/lang-less',
  '@codemirror/lang-markdown',
  '@codemirror/lang-php',
  '@codemirror/lang-python',
  '@codemirror/lang-rust',
  '@codemirror/lang-sass',
  '@codemirror/lang-sql',
  '@codemirror/lang-vue',
  '@codemirror/lang-wast',
  '@codemirror/lang-xml',
  '@codemirror/lang-yaml',
] as const;

/** Client modules that lazy-load the editor and trigger language-data discovery. */
const EDITOR_WARMUP_FILES = [
  './src/main.ts',
  './src/ui/file-viewer.ts',
  './src/ui/editor-language.ts',
] as const;

/** Rollup manual chunk groups for heavy vendor libraries. */
function manualChunkForNodeModule(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  if (id.includes('@codemirror') || id.includes('/codemirror/')) {
    return 'vendor-codemirror';
  }
  if (id.includes('@xterm')) {
    return 'vendor-xterm';
  }
  if (id.includes('/recharts/') || id.includes('/d3-')) {
    return 'vendor-charts';
  }
  if (id.includes('highlight.js')) {
    return 'vendor-highlight';
  }
  return undefined;
}

/** Vite build: relative asset paths for PWA / static hosting. */
export default defineConfig({
  base: './',
  envPrefix: ['VITE_', 'MINNOW_'],
  plugins: [uiconsWoff2OnlyPlugin(), cssBeforeEntryScriptPlugin()],
  optimizeDeps: {
    // Finish the first dep crawl before serving requests (avoids stale dist-* chunk URLs).
    holdUntilCrawlEnd: true,
    entries: ['index.html', ...EDITOR_WARMUP_FILES.map((f) => f.slice(2))],
    include: [...CODE_MIRROR_OPTIMIZE_INCLUDE, 'highlight.js'],
  },
  server: {
    warmup: {
      clientFiles: [...EDITOR_WARMUP_FILES],
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return manualChunkForNodeModule(id);
        },
      },
    },
  },
});
