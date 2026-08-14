import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';

const webRoot = fileURLToPath(new URL('.', import.meta.url));
const outputRoot = fileURLToPath(new URL('../../dist/web', import.meta.url));

export default defineConfig({
  root: webRoot,
  base: './',
  publicDir: false,
  build: {
    outDir: outputRoot,
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
    target: 'es2022',
  },
});
