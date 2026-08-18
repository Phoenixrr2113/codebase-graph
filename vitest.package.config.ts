import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts', '__tests__/**/*.test.ts'],
    passWithNoTests: false,
  },
})
