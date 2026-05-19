import { defineConfig } from 'vite';

/** Vite build: relative asset paths for PWA / static hosting. */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
  },
});
