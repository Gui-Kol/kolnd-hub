import { defineConfig } from '@playwright/test'
import { join } from 'path'

/**
 * E2E do app buildado (task 11, T10).
 *
 * Nada de rede real, microfone ou tempo de áudio: o main troca o transporte do
 * Gemini por um fake quando `ABSOLEM_TEST_TRANSPORT=fake` e o userData é um
 * diretório temporário (`ABSOLEM_TEST_USERDATA`). Uma execução por vez para
 * não disputar o lock de instância única.
 *
 * `retries: 1`: o harness do Electron no Windows ocasionalmente perde o
 * contexto de utilidade durante um `evaluate` ("Resulting promise was garbage
 * collected"), sem falha de asserção. O retry estabiliza o gate; um problema
 * real do app falha nas duas tentativas e continua reprovando.
 */
export default defineConfig({
  testDir: __dirname,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [
    ['list'],
    [
      join(__dirname, 'redacted-reporter.ts'),
      { outputFile: join(process.cwd(), 'test-results', 'e2e-report.json') }
    ]
  ],
  use: {
    trace: 'retain-on-failure'
  }
})
