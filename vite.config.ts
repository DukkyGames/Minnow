import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

/**
 * Vite injects the module script before extracted CSS in `index.html`, so JS can run
 * before the stylesheet finishes loading. Hoist bundle `<link rel="stylesheet">` tags
 * ahead of the entry `<script type="module">` in `<head>` so CSS starts earlier.
 */
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
  plugins: [cssBeforeEntryScriptPlugin()],
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
