import { app } from 'electron'
import { existsSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const FLAG_FILENAME = 'first-run-complete.flag'

/** Caminho completo do arquivo de flag de primeira execução. */
export function getFlagPath(): string {
  return join(app.getPath('userData'), FLAG_FILENAME)
}

/** Retorna true se o Kolnd Hub estiver sendo executado pela primeira vez. */
export function isFirstRun(): boolean {
  return !existsSync(getFlagPath())
}

/** Marca que a primeira execução já foi concluída. */
export function markFirstRunComplete(): void {
  const userDataDir = app.getPath('userData')
  if (!existsSync(userDataDir)) {
    mkdirSync(userDataDir, { recursive: true })
  }
  writeFileSync(getFlagPath(), '1', { encoding: 'utf8' })
}

/** Remove a flag (útil para testes ou reinstalação forçada). */
export function resetFirstRun(): void {
  const path = getFlagPath()
  if (existsSync(path)) {
    require('fs').unlinkSync(path)
  }
}
