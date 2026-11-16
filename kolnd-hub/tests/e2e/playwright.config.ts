import { defineConfig } from '@playwright/test'

/**
 * Playwright (task 04-4.1) — smoke E2E do Hub no Electron real.
 *
 * `testDir` é este próprio diretório (o `./tests/e2e` do enunciado pressupõe
 * config na raiz; com a config aqui dentro, `.` é o equivalente correto).
 * 1 worker: o app segura o single-instance lock, então specs paralelos
 * colidiriam entre si.
 *
 * O build é feito pelo script `npm run test:e2e` (`npm run build && playwright
 * test --config=tests/e2e/playwright.config.ts`), não por aqui.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // Artefatos do Playwright sob `kolnd-hub/out/` (já ignorado por .prettierignore/.gitignore);
  // o default `test-results/` na raiz quebraria o `prettier --check .` do verify.
  outputDir: '../../out/test-results',
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  projects: [
    {
      name: 'electron',
      use: {}
    }
  ]
})
