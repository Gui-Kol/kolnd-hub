import { defineConfig } from 'vitest/config'

// Testes unitários puros (lógica de renderer/lib e helpers do main).
// Nada daqui testa Electron/React — apenas funções puras.
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
        'out/**',
        'dist/**',
        'resources/**',
        'tests/**',
        '*.config.*',
        '**/*.config.*'
      ],
      // Limiares conservadores ~5 p.p. abaixo da medição real (13/11/2026),
      // escopados a src/main (o que a suíte unitária mede de fato).
      // Medição: lines/statements 44.36%, functions 72.8%, branches 79.36%.
      // Informativos: o CI roda test:coverage com continue-on-error.
      thresholds: {
        'src/main/**': {
          lines: 39,
          statements: 39,
          functions: 67,
          branches: 74
        }
      }
    }
  }
})
