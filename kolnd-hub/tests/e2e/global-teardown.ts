import { existsSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * Global teardown do Playwright (task 04-4.1): remove TODO o diretório temporário
 * do contexto (userData isolado + stubs) e o arquivo de contexto. Garante que o
 * smoke nunca deixe dados para trás — e que nenhum dado real foi lido/gravado.
 */
const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(CONTEXT_FILE)) return
  try {
    const context = JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
    // Sanidade: só apagamos o que está sob o tmp e com o prefixo esperado.
    const root = context.root ?? ''
    const isSafe = /[/\\]kolnd-hub-e2e-[^/\\]*$/.test(root) && root.startsWith(tmpdir())
    if (isSafe) {
      rmSync(root, { recursive: true, force: true })
    } else {
      console.warn(`[e2e] teardown: root suspeito, não removido: ${root}`)
    }
  } catch (err) {
    console.warn('[e2e] teardown: falha ao limpar contexto:', err)
  } finally {
    try {
      rmSync(CONTEXT_FILE, { force: true })
    } catch {
      // best-effort
    }
  }
}
