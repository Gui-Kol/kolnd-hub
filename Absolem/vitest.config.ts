import { defineConfig } from 'vitest/config'

// Testes unitários co-localizados, sempre em ambiente Node (sem Electron real).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'out', 'dist', 'resources', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Só lógica de main/shared entra na meta. Renderer, preload, scripts e
      // composições que só ligam Electron ficam fora: a UI visual tem e2e/axe,
      // não meta de linha.
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.d.ts',
        'out/**',
        'dist/**',
        'resources/**',
        'tests/**',
        '*.config.*',
        // Composição/eletron: sem unidade possível em Node puro.
        'src/main/index.ts',
        'src/main/testUserData.ts',
        'src/main/**/instance.ts',
        'src/main/gemini/sdk.ts',
        'src/main/gemini/transport.ts',
        'src/main/ipc/index.ts',
        'src/main/actions/shortcut.ts',
        'src/main/voice/shortcut.ts'
      ],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 60,
        statements: 70
      }
    }
  }
})
