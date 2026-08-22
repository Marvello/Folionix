import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', '../lib/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // count every source file, not only ones imported by tests
      // (../lib can't be globbed from here — its files have their own tests)
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts'],
    },
  },
})
