import { defineConfig } from 'vitest/config';

process.env.TZ = 'Asia/Taipei';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
    include: ['src/**/*.test.ts'],
  },
});
