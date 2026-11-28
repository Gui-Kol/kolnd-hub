import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

/** Mesmo padrão da fundação do Hub, com o nome do Absolem em userData. */
const FLAG_FILENAME = 'first-run-complete.flag'

/** Caminho completo do flag de primeira execução. */
export function getFirstRunFlagPath(): string {
  return join(app.getPath('userData'), FLAG_FILENAME)
}

/** `true` enquanto o flag não existir; erro de leitura nunca relança o balão. */
export function isFirstRun(): boolean {
  try {
    return !existsSync(getFirstRunFlagPath())
  } catch {
    return false
  }
}

/**
 * Marca a primeira execução como concluída. Pode lançar (disco cheio/sem
 * permissão); o chamador trata como best-effort para não derrubar o app.
 */
export function markFirstRunComplete(): void {
  const flagPath = getFirstRunFlagPath()
  mkdirSync(dirname(flagPath), { recursive: true })
  writeFileSync(flagPath, '1', { encoding: 'utf8' })
}
