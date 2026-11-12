import { defineConfig } from 'vitest/config'

// Testes unitários puros (lógica de renderer/lib e helpers do main).
// Nada daqui testa Electron/React — apenas funções puras.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'out', 'dist', 'resources']
  }
})
