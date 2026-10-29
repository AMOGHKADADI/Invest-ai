import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The GitHub Pages deployment serves the app from a repository sub-path
 * (https://<user>.github.io/<repo>/), so the deploy workflow sets
 * VITE_BASE_PATH=/\<repo\>/ while local development stays at "/".
 */
const base = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: ['default'],
  },
});
