import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    // Nest imports it at startup; isolated unit tests must load it themselves.
    setupFiles: ['reflect-metadata'],
    root: './',
    include: ['**/*.spec.ts'],
  },
});
