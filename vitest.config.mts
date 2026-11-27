import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // The real `obsidian` package only ships type definitions; tests run against a small stand-in.
    alias: { obsidian: fileURLToPath(new URL('./tests/stubs/obsidian.ts', import.meta.url)) },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
