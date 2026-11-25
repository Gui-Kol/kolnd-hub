import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import type { GameSourceImportReport } from '../shared/gameImport'
import { addGame, extractIconPng, gameIconsDir, getGames } from './games'
import { findGameExecutable } from './games/exeFinder'
import { logger } from './logger'

export { findGameExecutable } from './games/exeFinder'

/**
 * Importação automática de jogos Steam para a Biblioteca do Kolnd Hub.
 *
 * Fluxo: localizar a Steam (registro → caminhos padrão) → ler as
 * bibliotecas declaradas em `libraryfolders.vdf` → varrer os
 * `appmanifest_*.acf` de cada `steamapps` → filtrar ferramentas/
 * redistribuíveis → localizar o executável de cada jogo → extrair o ícone
 * embutido → persistir via `addGame` (id determinístico, dedupe por
 * `steamAppId`). Nenhum console externo é aberto (spawnSync com
 * `windowsHide` e `reg query` sem shell).
 *
 * O relatório segue o contrato compartilhado `GameSourceImportReport`
 * (`src/shared/gameImport.ts`): a ausência da Steam é `detected: false` com
 * mensagem amigável, não um erro global do orquestrador.
 */

/** Relatório-base da Steam: zera os contadores mantendo source/label fixos. */
function emptySteamReport(): GameSourceImportReport {
  return {
    source: 'steam',
    label: 'Steam',
    detected: true,
    imported: 0,
    alreadyInLibrary: 0,
    ignored: 0,
    noExe: 0,
    errors: []
  }
}

const REG_QUERY_TIMEOUT_MS = 5000

/** Nomes (case-insensitive, substring) que identificam ferramentas, não jogos. */
const TOOL_NAME_PATTERNS = [
  'proton',
  'steamworks common redistributables',
  'steam linux runtime',
  'steam demo',
  'easy anticheat'
]

/** appIDs utilitários conhecidos (redistribuíveis/runtimes) mesmo fora dos padrões de nome. */
const KNOWN_TOOL_APP_IDS = new Set<number>([
  228980, // Steamworks Common Redistributables
  1070560, // Steam Linux Runtime 1.0 (scout)
  1245040, // Steam Linux Runtime 2.0 (soldier)
  1391110, // Steam Linux Runtime / Proton experimental antigo
  1493710, // Proton Experimental
  1586910, // Steam Linux Runtime 3.0 (sniper)
  1628350, // Proton 7.0
  2180100 // Proton Hotfix
])

/* ── Localização da Steam ─────────────────────────────────────────── */

/** Executa `reg query <key> /v <valueName>` e devolve o valor bruto, ou null. */
function queryRegistryValue(key: string, valueName: string): string | null {
  try {
    const result = spawnSync('reg', ['query', key, '/v', valueName], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: REG_QUERY_TIMEOUT_MS
    })
    if (result.status !== 0) return null
    const output = result.stdout ?? ''
    // Linha de valor: "    SteamPath    REG_SZ    c:/program files (x86)/steam"
    const pattern = new RegExp(`${valueName}\\s+REG_[A-Z_]+\\s+(.+)`, 'i')
    for (const line of output.split(/\r?\n/)) {
      const match = pattern.exec(line)
      if (match) {
        // O registro pode gravar barras normais ("c:/...") — normaliza para o Windows.
        const value = match[1].trim().replace(/\//g, '\\')
        return value || null
      }
    }
    return null
  } catch {
    return null
  }
}

function isUsableSteamRoot(candidate: string | null): candidate is string {
  if (!candidate) return false
  try {
    return statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

/** Localiza a raiz da Steam, na ordem: HKCU → HKLM (WOW6432Node) → caminhos padrão. */
export function findSteamRoot(): string | null {
  const candidates: Array<string | null> = [
    queryRegistryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
    queryRegistryValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam'
  ]
  for (const candidate of candidates) {
    if (isUsableSteamRoot(candidate)) return candidate
  }
  return null
}

/* ── libraryfolders.vdf ───────────────────────────────────────────── */

/** Desescapa o formato VDF (`\\\\` → `\`). */
function unescapeVdfPath(value: string): string {
  return value.replace(/\\\\/g, '\\')
}

/**
 * Extrai os caminhos das bibliotecas declaradas no `libraryfolders.vdf`.
 * Formato novo: `"path"  "<caminho>"`. Formato legado: chaves numéricas com o
 * caminho bruto (`"1"  "D:\\SteamLibrary"`). A raiz da Steam é incluída por
 * `findSteamLibraries`, não aqui.
 */
export function parseLibraryFolders(vdfContent: string): string[] {
  const libraries = new Map<string, string>() // chave normalizada → caminho original
  const add = (rawPath: string): void => {
    const cleaned = unescapeVdfPath(rawPath.trim())
    if (!cleaned) return
    const key = cleaned.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
    if (!libraries.has(key)) libraries.set(key, cleaned.replace(/\//g, '\\'))
  }

  const modern = /"path"\s+"([^"]+)"/g
  let match: RegExpExecArray | null
  let foundModern = false
  while ((match = modern.exec(vdfContent)) !== null) {
    foundModern = true
    add(match[1])
  }
  if (!foundModern) {
    // Fallback legado: chaves numéricas cujo valor parece um caminho.
    const legacy = /^\s*"\d+"\s+"([^"]+)"/gm
    while ((match = legacy.exec(vdfContent)) !== null) {
      const value = match[1]
      if (/^([A-Za-z]:[\\/]|\\\\|\/)/.test(value)) add(value)
    }
  }

  return [...libraries.values()]
}

/** Devolve as bibliotecas Steam (raiz + as declaradas), deduplicadas e com `steamapps` existente. */
export function findSteamLibraries(steamRoot: string): string[] {
  const candidates = [steamRoot]
  const vdfPath = join(steamRoot, 'steamapps', 'libraryfolders.vdf')
  try {
    if (existsSync(vdfPath)) {
      candidates.push(...parseLibraryFolders(readFileSync(vdfPath, 'utf8')))
    }
  } catch (err) {
    logger.warn('steam', 'Não foi possível ler libraryfolders.vdf:', err)
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const candidate of candidates) {
    const key = candidate.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    try {
      if (statSync(candidate).isDirectory() && existsSync(join(candidate, 'steamapps'))) {
        out.push(candidate)
      }
    } catch {
      // Biblioteca inacessível — ignora e segue para as demais.
    }
  }
  return out
}

/* ── appmanifest_*.acf ────────────────────────────────────────────── */

export interface SteamAppManifest {
  appId: number
  name: string
  installDir: string
}

/** Extrai appid/name/installdir de um `appmanifest_*.acf`. Devolve null se inválido. */
export function parseAppManifest(acfContent: string): SteamAppManifest | null {
  const appIdMatch = /"appid"\s+"(\d+)"/.exec(acfContent)
  const nameMatch = /"name"\s+"([^"]+)"/.exec(acfContent)
  const installDirMatch = /"installdir"\s+"([^"]+)"/.exec(acfContent)
  if (!appIdMatch || !nameMatch || !installDirMatch) return null
  const appId = Number.parseInt(appIdMatch[1], 10)
  if (!Number.isInteger(appId) || appId < 0) return null
  const name = nameMatch[1].trim()
  const installDir = installDirMatch[1].trim()
  if (!name || !installDir) return null
  return { appId, name, installDir }
}

/** true quando a entrada é ferramenta/redistribuível, não um jogo. */
function isToolEntry(name: string, appId: number): boolean {
  const normalized = name.toLowerCase()
  if (TOOL_NAME_PATTERNS.some((pattern) => normalized.includes(pattern))) return true
  return KNOWN_TOOL_APP_IDS.has(appId)
}

/* ── Importação ───────────────────────────────────────────────────── */

/** Deterministic id: reimportar o mesmo jogo nunca gera duplicata. */
function steamGameId(appId: number, exePath: string): string {
  const hash = createHash('sha1').update(exePath.toLowerCase()).digest('hex').slice(0, 10)
  return `steam-${appId}-${hash}`
}

/** Executa a varredura completa da Steam. Nunca lança — falhas por jogo vão para `errors`. */
export async function scanSteamGames(): Promise<GameSourceImportReport> {
  const report = emptySteamReport()

  const steamRoot = findSteamRoot()
  if (!steamRoot) {
    // Fonte ausente não é erro: o orquestrador segue para Epic/Minecraft.
    report.detected = false
    report.message = 'Steam não detectada. Verifique se ela está instalada.'
    return report
  }

  const libraries = findSteamLibraries(steamRoot)
  logger.info('steam', `${libraries.length} biblioteca(s) encontrada(s) em ${steamRoot}`)

  // Manifestos de todas as bibliotecas, deduplicados por appid (primeira ocorrência vence).
  const manifests = new Map<number, { manifest: SteamAppManifest; library: string }>()
  for (const library of libraries) {
    const steamapps = join(library, 'steamapps')
    let entries: string[]
    try {
      entries = readdirSync(steamapps)
    } catch (err) {
      logger.warn('steam', `Sem acesso a ${steamapps}:`, err)
      continue
    }
    for (const entry of entries) {
      if (!/^appmanifest_\d+\.acf$/i.test(entry)) continue
      try {
        const parsed = parseAppManifest(readFileSync(join(steamapps, entry), 'utf8'))
        if (!parsed) {
          // Manifesto presente mas inválido: entrada descartada de propósito.
          report.ignored += 1
          continue
        }
        if (!manifests.has(parsed.appId)) manifests.set(parsed.appId, { manifest: parsed, library })
      } catch (err) {
        logger.warn('steam', `Falha ao ler ${entry}:`, err)
      }
    }
  }

  const existing = getGames()
  const existingSteamIds = new Set(
    existing.map((game) => game.steamAppId).filter((id): id is number => id !== undefined)
  )
  const existingIds = new Set(existing.map((game) => game.id))
  const now = new Date().toISOString()

  for (const { manifest, library } of manifests.values()) {
    const { appId, name, installDir } = manifest

    if (isToolEntry(name, appId)) {
      report.ignored += 1
      continue
    }

    if (existingSteamIds.has(appId)) {
      report.alreadyInLibrary += 1
      continue
    }

    const installPath = join(library, 'steamapps', 'common', installDir)
    const exePath = findGameExecutable(installPath)
    if (!exePath) {
      report.noExe += 1
      continue
    }

    const id = steamGameId(appId, exePath)
    if (existingIds.has(id)) {
      report.alreadyInLibrary += 1
      continue
    }

    // Ícone embutido → PNG em %APPDATA%/kolnd-hub/game-icons/steam_<appid>.png.
    const iconPath = join(gameIconsDir(), `steam_${appId}.png`)
    const iconOk = await extractIconPng(exePath, iconPath)

    const result = addGame({
      id,
      name,
      exePath,
      iconPath: iconOk ? iconPath : null,
      origin: 'steam',
      steamAppId: appId,
      addedAt: now
    })

    if (result.success) {
      report.imported += 1
      existingSteamIds.add(appId)
      existingIds.add(id)
    } else {
      // Jogo já presente por outro critério (ex.: mesmo .exe de um jogo personalizado)
      // conta como "já estava na biblioteca", não como erro.
      const message = result.error ?? 'erro desconhecido'
      if (message.includes('Já existe') || message.includes('já está na sua biblioteca')) {
        report.alreadyInLibrary += 1
      } else {
        report.errors.push(`${name}: ${message}`)
      }
    }
  }

  logger.info(
    'steam',
    `Busca concluída: ${report.imported} importado(s), ` +
      `${report.alreadyInLibrary} já na biblioteca, ${report.ignored} ignorado(s), ` +
      `${report.noExe} sem executável, ${report.errors.length} erro(s)`
  )
  return report
}
