import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    reporters: ['default'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: [
        'src/application/**/*.ts',
        'src/config/**/*.ts',
        'src/domain/**/*.ts',
        'src/shared/**/*.ts',
        'src/simulation/**/*.ts',
      ],
    },
  },
})
