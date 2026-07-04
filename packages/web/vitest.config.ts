import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'bun:test': fileURLToPath(new URL('./test/bun-test-shim.ts', import.meta.url)),
      // EPISTEMOS(PATCH_LEDGER#P4b): mirror the vite build aliases so overlay
      // tests can exercise @openchamber/ui modules (this file overrides
      // vite.config.ts, which already defines these for the app build).
      '@openchamber/ui': fileURLToPath(new URL('../ui/src', import.meta.url)),
      '@web': fileURLToPath(new URL('./src', import.meta.url)),
      '@': fileURLToPath(new URL('../ui/src', import.meta.url)),
    },
  },
});
