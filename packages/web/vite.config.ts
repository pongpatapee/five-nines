/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // This worktree runs alongside others; fail loudly rather than drift to another port.
    port: 5174,
    strictPort: true,
  },
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
