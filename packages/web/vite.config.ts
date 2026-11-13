/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // The public path the site is served from. GitHub Pages serves this repo under /five-nines/; locally it's /.
  base: process.env.BASE_PATH ?? '/',
  build: {
    rolldownOptions: {
      output: {
        // Third-party code changes rarely; keep it in its own long-cacheable chunk.
        codeSplitting: { groups: [{ name: 'vendor', test: /node_modules/ }] },
      },
    },
  },
  worker: {
    // The engine worker imports the sim package, which is ES modules throughout.
    format: 'es',
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
