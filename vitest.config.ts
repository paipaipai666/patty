import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Pure-function unit tests only. They live under src/**/*.test.ts and
    // exercise tree operations and workspace normalization — no React,
    // no DOM, no PTY.
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false
  },
  coverage: {
    provider: 'v8',
    include: ['src/**/*.ts'],
    exclude: [
      'src/**/*.test.ts',
      'src/**/*.d.ts',
      'src/**/*.test-d.ts'
    ],
    reporter: ['text', 'lcov', 'html'],
    reportsDirectory: 'coverage'
  }
})
