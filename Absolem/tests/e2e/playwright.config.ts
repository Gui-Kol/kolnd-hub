import { defineConfig } from '@playwright/test'

/**
 * E2E do app buildado (task 11, T10).
 *
 * Nada de rede real, microfone ou tempo de áudio: o main troca o transporte do
 * Gemini por um fake quando `ABSOLEM_TEST_TRANSPORT=fake` e o userData é um
 * diretório temporário (`ABSOLEM_TEST_USERDATA`). Uma execução por vez para
 * não disputar o lock de instância única.
 */
export default defineConfig({
  testDir: __dirname,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure'
  }
})
