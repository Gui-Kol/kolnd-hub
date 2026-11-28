/**
 * Configurações dos apps embutidos que vivem FORA de %APPDATA%\kolnd-hub.
 *
 * O Absolem grava em `%APPDATA%\absolem` (Electron `userData`: config,
 * memória SQLite, chave cifrada, logs e Crashpad). O Kloud Games grava em
 * `C:\Program Files\KLOUD_GAMES\config` (per-machine), em
 * `%LOCALAPPDATA%\LizardByte\KLOUD_GAMES` (config do serviço) e em
 * `%ProgramData%\KLOUD_GAMES` (undo do perfil NVIDIA). Nenhuma dessas pastas
 * é conhecida pelo desinstalador NSIS do Hub nem pelo MSI do Kloud Games, por
 * isso a remoção é feita aqui — item a item, tolerante a falhas e com trava de
 * nome (nunca apaga uma pasta que não seja a esperada).
 */
import { app } from 'electron'
import { existsSync, readdirSync, rmdirSync, rmSync } from 'fs'
import { basename, join } from 'path'
import type { HubWipeResult } from './shared'

/** Nome esperado da pasta de dados do Absolem — trava de segurança do wipe. */
export const ABSOLEM_DATA_BASENAME = 'absolem'

/** Nome esperado das pastas de configuração do Kloud Games. */
export const KLOUD_GAMES_DATA_BASENAME = 'KLOUD_GAMES'

/** Pasta de dados do Absolem (Electron `userData`, fora da instalação do Hub). */
export function getAbsolemDataDir(): string {
  return join(app.getPath('appData'), ABSOLEM_DATA_BASENAME)
}

/**
 * Configurações do Kloud Games por usuário (podem ser apagadas sem UAC):
 * `%LOCALAPPDATA%\LizardByte\KLOUD_GAMES` (config do serviço) e
 * `%ProgramData%\KLOUD_GAMES` (undo do driver NVIDIA, quando existir).
 */
export function getKloudGamesPerUserConfigDirs(): string[] {
  const dirs: string[] = []
  const localAppData = process.env.LOCALAPPDATA || ''
  if (localAppData) dirs.push(join(localAppData, 'LizardByte', KLOUD_GAMES_DATA_BASENAME))
  const programData = process.env.ProgramData || process.env.PROGRAMDATA || ''
  if (programData) dirs.push(join(programData, KLOUD_GAMES_DATA_BASENAME))
  return dirs
}

/**
 * Configurações DENTRO da instalação per-machine
 * (`<Program Files>\KLOUD_GAMES\config`, incluindo `credentials`). Só um
 * processo elevado consegue apagá-las — o MSI não as conhece porque são
 * criadas em runtime.
 */
export function getKloudGamesInstallConfigDirs(): string[] {
  const dirs: string[] = []
  const programFiles = process.env.ProgramFiles || process.env.PROGRAMFILES || ''
  if (programFiles) {
    dirs.push(join(programFiles, KLOUD_GAMES_DATA_BASENAME, 'config'))
  }
  const programFilesX86 = process.env['ProgramFiles(x86)'] || process.env['PROGRAMFILES(X86)'] || ''
  if (programFilesX86) {
    dirs.push(join(programFilesX86, KLOUD_GAMES_DATA_BASENAME, 'config'))
  }
  return dirs
}

/** Todas as pastas de configuração do Kloud Games (instalação + por usuário). */
export function getKloudGamesConfigDirs(): string[] {
  return [...getKloudGamesInstallConfigDirs(), ...getKloudGamesPerUserConfigDirs()]
}

/** Escapa um caminho para uso dentro de uma string single-quoted do PowerShell. */
export function escapePowerShellLiteral(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * Apaga o conteúdo de `targetDir` item a item, tolerando falhas individuais.
 *
 * Segurança: só opera quando o `basename` está em `expectedBasenames`
 * (case-insensitive). Qualquer outro alvo é recusado e nada é apagado — a
 * decisão de onde apagar fica sempre com o chamador (pasta resolvida a partir
 * de `app.getPath`/variáveis de ambiente oficiais).
 */
export function wipeConfigFolder(
  targetDir: string,
  expectedBasenames: readonly string[],
  log: (line: string) => void,
  prefix: string,
  onItem?: (item: string, ok: boolean, error?: string) => void
): HubWipeResult {
  const result: HubWipeResult = { inventory: [], deleted: [], errors: [] }

  const name = basename(join(targetDir, '.')).toLowerCase()
  const allowed = expectedBasenames.map((item) => item.toLowerCase())
  if (!allowed.includes(name)) {
    const message = `Recusando apagar pasta inesperada (esperado ${allowed.join(' ou ')}): ${targetDir}`
    log(`${prefix} ${message}\n`)
    result.errors.push({ item: targetDir, error: message })
    return result
  }

  let entries: string[]
  try {
    entries = readdirSync(targetDir).sort((a, b) =>
      a.localeCompare(b, 'en', { sensitivity: 'base' })
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (existsSync(targetDir)) {
      // Pasta existe mas não pôde ser lida (permissão/bloqueio).
      log(`${prefix} Não foi possível ler o inventário de ${targetDir}: ${message}\n`)
      result.errors.push({ item: targetDir, error: message })
    } else {
      log(`${prefix} ${targetDir} não existe — nada para apagar.\n`)
    }
    return result
  }

  result.inventory = entries
  log(
    `${prefix} Inventário de ${targetDir} (${entries.length} ${entries.length === 1 ? 'item' : 'itens'}): ${entries.join(', ') || '(pasta vazia)'}\n`
  )

  for (const entry of entries) {
    const target = join(targetDir, entry)
    try {
      rmSync(target, { recursive: true, force: true })
      result.deleted.push(entry)
      log(`${prefix} Apagado: ${target}\n`)
      onItem?.(entry, true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push({ item: entry, error: message })
      log(`${prefix} Falha ao apagar ${target}: ${message}\n`)
      onItem?.(entry, false, message)
    }
  }

  // Se sobrou alguma coisa (falhas), a pasta permanece com esses itens; senão, remove a raiz.
  try {
    rmdirSync(targetDir)
  } catch {
    // Não vazia ou indisponível — os itens com falha ficam para o laudo.
  }

  return result
}
