import { defineConfig } from 'vitest/config'
import path from 'path'
import ValidationSequencer from './tests/validation/sequencer.js'

export default defineConfig({
  resolve: {
    alias: {
      '@arcpass/shared': path.resolve(__dirname, 'packages/shared/dist/index.js'),
    },
  },
  test: {
    include: ['tests/validation/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    sequence: {
      sequencer: ValidationSequencer,
    },
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
})
