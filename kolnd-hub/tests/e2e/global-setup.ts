import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createStubs } from './stubs'

/**
 * Global setup do Playwright (task 04-4.1).
 *
 * Pré-requisito: o build já foi feito pelo script `npm run test:e2e`
 * (`npm run build && playwright test ...`) — aqui só montamos o ambiente:
 *
 * 1. `userData` isolado em diretório temporário (NUNCA toca em
 *    %APPDATA%\kolnd-hub real) com a flag `first-run-complete.flag` semeada,
 *    suprimindo a tela de primeira execução;
 * 2. stubs de winget/msiexec em dir temporário (ver stubs.ts);
 * 3. um `.e2e-context.json` no tmp (caminho fixo e conhecido por setup,
 *    teardown e specs) com os caminhos acima.
 *
 * Caminho do contexto: `KOLDND_HUB_E2E_CONTEXT` ou `<tmp>/kolnd-hub-e2e-context.json`.
 */
export const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')

export interface E2eContext {
  root: string
  userDataDir: string
  stubsDir: string
  stubsLog: string
}

export default async function globalSetup(): Promise<void> {
  // Contexto anterior (execução interrompida): remove antes de recriar.
  try {
    if (existsSync(CONTEXT_FILE)) rmSync(CONTEXT_FILE, { force: true })
  } catch {
    // arquivo travado não impede a criação de um novo contexto
  }

  const root = mkdtempSync(join(tmpdir(), 'kolnd-hub-e2e-'))
  const userDataDir = join(root, 'userData')
  mkdirSync(userDataDir, { recursive: true })

  // Flag de primeira execução: sem ela o app abre no wizard em vez do Dashboard.
  writeFileSync(join(userDataDir, 'first-run-complete.flag'), '1', 'utf8')

  const { stubsDir, stubsLog } = createStubs(root)

  const context: E2eContext = { root, userDataDir, stubsDir, stubsLog }
  writeFileSync(CONTEXT_FILE, JSON.stringify(context, null, 2), 'utf8')
}
