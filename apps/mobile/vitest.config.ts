import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Unit tests for the React-Native-free code in src/data. Screens are checked by typecheck + the Android bundle.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
