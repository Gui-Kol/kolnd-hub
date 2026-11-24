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
        '**/*.config.*',
        // Bootstrap/glue sem lógica própria: cobertos pelo Playwright e2e (D3).
        // - index.ts (main) registra handlers/janela; App/main.tsx montam o React.
        // - components/** é UI (decisão do usuário: e2e cobre).
        // - env.d.ts/types.ts e fps.ts só declaram tipos (nada executável).
        'src/main/index.ts',
        'src/renderer/src/App.tsx',
        'src/renderer/src/main.tsx',
        'src/renderer/src/components/**',
        'src/renderer/src/env.d.ts',
        'src/renderer/src/types.ts',
        'src/shared/fps.ts',
        '**/*.d.ts'
      ],
      // Limiares reais da suíte (24/11/2026) com margem de ~2–4 p.p. abaixo do
      // medido — nunca acima. `src/main/index.ts`, `App.tsx`, `main.tsx` e
      // `components/**` ficam fora da medição (bootstrap/glue cobertos por e2e);
      // medido: main 93,83% linhas · shared 98,13% · preload 100% ·
      // renderer/lib 98,97% · renderer/hooks 99,64%.
      thresholds: {
        'src/main/**': {
          lines: 90,
          statements: 90,
          functions: 94,
          branches: 84
        },
        'src/shared/**': {
          lines: 95,
          statements: 95
        },
        'src/preload/**': {
          lines: 95,
          statements: 95
        },
        'src/renderer/src/lib/**': {
          lines: 95,
          statements: 95
        },
        'src/renderer/src/hooks/**': {
          lines: 96,
          statements: 96
        }
      }
    }
  }
})
