import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup-e2e.ts'],
    globalSetup: ['./test/global-setup-e2e.ts'],
    // One shared test database: files must not run concurrently.
    fileParallelism: false,
  },
});
