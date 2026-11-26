import { defineConfig } from 'vitest/config'

// Testes unitários co-localizados, sempre em ambiente Node (sem Electron real).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'out', 'dist', 'resources'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.d.ts',
        'out/**',
        'dist/**',
        'resources/**',
        'tests/**',
        '*.config.*',
        'src/main/index.ts',
        'src/renderer/**'
      ]
    }
  }
})
