import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/property/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/*.smoke.test.ts',
    ],
    testTimeout: 10000,
  },
})
