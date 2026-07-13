import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  test: {
    globals: false,
    // Two projects: pure node unit tests, and React/renderer tests that need a
    // DOM (jsdom) and JSX transform. The renderer project only picks up .tsx/.ts
    // under src/renderer so existing main/shared unit tests are unaffected.
    projects: [
      {
        test: {
          name: 'node',
          include: ['src/**/*.test.ts'],
          environment: 'node'
        }
      },
      {
        test: {
          name: 'renderer',
          include: ['src/renderer/**/*.test.tsx'],
          environment: 'jsdom'
        },
        plugins: [react()]
      }
    ]
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
