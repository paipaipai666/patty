import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  test: {
    globals: false,

    projects: [
      {
        test: {
          name: 'node',
          include: ['src/**/*.test.ts', 'resources/**/*.test.ts'],
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
