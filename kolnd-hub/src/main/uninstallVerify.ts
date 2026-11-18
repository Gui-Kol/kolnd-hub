import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

import {
  findKloudGamesExe,
  getKloudGamesUninstallLogPath,
  resetKloudGamesState
} from './kloudGames'
import { findKloudGamesUninstallEntry, getKloudGamesServiceStatus } from './uninstallDetection'

/** Nome da pasta de atalhos do Kloud Games dentro do Menu Iniciar. */
const START_MENU_PARENT = 'LizardByte'
const START_MENU_PREFIX = 'KLOUD_GAMES'

export interface KloudGamesUninstallReport {
  exeGone: boolean
  serviceGone: boolean
  registryGone: boolean
  shortcutsGone: boolean
  tempCleaned: boolean
  remaining: string[]
  logPath: string
}

/** O executável KLOUD_GAMES.exe não está mais presente (zera o estado salvo antes de checar). */
export function checkExeGone(): boolean {
  try {
    resetKloudGamesState()
  } catch {
    // Zerar o estado é best-effort; segue para a checagem real do exe.
  }
  return findKloudGamesExe() === null
}

/** O serviço KLOUD_GAMESsvc não existe mais (`sc query` → 1060 → 'missing'). */
export function checkServiceGone(): boolean {
  return getKloudGamesServiceStatus() === 'missing'
}

/** A entrada de desinstalação do Kloud Games saiu do registro. */
export function checkRegistryGone(): boolean {
  return findKloudGamesUninstallEntry() === null
}

/**
 * Os atalhos do Menu Iniciar (`LizardByte\KLOUD_GAMES` e `KLOUD_GAMES*.lnk`
 * na raiz de Programs) sumiram. Falha ao ler → considera ausente (tolerante).
 */
export function checkShortcutsGone(): boolean {
  try {
    const appData = process.env.APPDATA || ''
    if (!appData) return true

    const programsDir = join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    if (existsSync(join(programsDir, START_MENU_PARENT, 'KLOUD_GAMES'))) return false

    let entries: string[]
    try {
      entries = readdirSync(programsDir)
    } catch {
      return true // não dá pra ler → considera ausente
    }

    const prefix = START_MENU_PREFIX.toLowerCase()
    for (const entry of entries) {
      const lower = entry.toLowerCase()
      if (lower.startsWith(prefix) && lower.endsWith('.lnk')) return false
    }
    return true
  } catch {
    return true
  }
}

/** A pasta %TEMP%\KLOUD_GAMES foi removida (ou nunca existiu). */
export function checkTempCleaned(): boolean {
  try {
    const temp = process.env.TEMP || process.env.TMP || ''
    if (!temp) return true
    return !existsSync(join(temp, 'KLOUD_GAMES'))
  } catch {
    return true
  }
}

/**
 * Laudo pós-desinstalação do Kloud Games.
 * Tolerante: nenhuma verificação derruba o fluxo — itens que ainda estiverem
 * presentes vão apenas para `remaining[]` (atalhos/temp são avisos, não
 * impedem o sucesso real).
 */
export function verifyKloudGamesRemoval(): KloudGamesUninstallReport {
  const logPath = getKloudGamesUninstallLogPath()
  const remaining: string[] = []

  const exeGone = checkExeGone()
  if (!exeGone) {
    remaining.push('O executável KLOUD_GAMES.exe ainda está presente após a desinstalação.')
  }

  const serviceGone = checkServiceGone()
  if (!serviceGone) {
    remaining.push('O serviço KLOUD_GAMESsvc ainda está presente após a desinstalação.')
  }

  const registryGone = checkRegistryGone()
  if (!registryGone) {
    remaining.push('A entrada de desinstalação do Kloud Games ainda está presente no registro.')
  }

  const shortcutsGone = checkShortcutsGone()
  if (!shortcutsGone) {
    remaining.push('Atalhos do KLOUD_GAMES ainda estão presentes no Menu Iniciar.')
  }

  const tempCleaned = checkTempCleaned()
  if (!tempCleaned) {
    remaining.push('A pasta %TEMP%\\KLOUD_GAMES ainda existe.')
  }

  return { exeGone, serviceGone, registryGone, shortcutsGone, tempCleaned, remaining, logPath }
}
