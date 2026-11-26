import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'

// Fonte única da versão: package.json (mesmo define usado por electron-vite).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

// Testes unitários co-localizados, sempre em ambiente Node (sem Electron real).
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'out', 'dist', 'resources', 'tests/e2e/**'],
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
