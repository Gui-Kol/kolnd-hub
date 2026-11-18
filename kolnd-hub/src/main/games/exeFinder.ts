import { readdirSync, statSync } from 'fs'
import { basename, join } from 'path'

/**
 * Localização do executável de um jogo instalado pela Steam.
 *
 * A regra "maior .exe" sozinha escolhia ferramentas/redistribuíveis
 * (ex.: `tools/ModUploader/ModUploader.exe` no Isaac, o launcher da Rockstar
 * no GTA V) — o card herdava o ícone genérico do Windows em vez do ícone do
 * jogo. A escolha agora prioriza a raiz da instalação e ignora pastas de
 * ferramentas/redistribuíveis, mas mantém a varredura em subpastas para jogos
 * cujo binário real vive em `bin/`/`binaries/`.
 */

/** Profundidade máxima da varredura a partir da raiz do jogo (0 = só a raiz). */
export const EXE_SCAN_MAX_DEPTH = 2

/** Padrões de executável que NUNCA são o jogo em si (instaladores/crash handlers). */
const EXE_EXCLUDE_SUBSTRINGS = ['setup', 'redist', 'crashhandler', 'prereq']
const EXE_EXCLUDE_PREFIXES = ['unins', 'vc_redist', 'unitycrashhandler', 'ueprereq']

/**
 * Pastas de ferramentas/redistribuíveis: nunca contêm o executável do jogo.
 * Comparadas em minúsculas e sem pontuação (`_CommonRedist` → `commonredist`).
 */
const EXE_TOOL_DIRECTORIES = new Set([
  'tools',
  'tool',
  'redist',
  'redists',
  'redistributable',
  'redistributables',
  'commonredist',
  'support',
  'installers',
  'installer',
  'directx',
  'vcredist',
  'dotnet',
  'battleye',
  'easyanticheat'
])

interface ExeCandidate {
  path: string
  size: number
  /** Distância da raiz da instalação (0 = o próprio diretório do jogo). */
  depth: number
}

function isExcludedExeName(fileName: string): boolean {
  const name = fileName.toLowerCase()
  if (EXE_EXCLUDE_PREFIXES.some((prefix) => name.startsWith(prefix))) return true
  return EXE_EXCLUDE_SUBSTRINGS.some((part) => name.includes(part))
}

/** Normaliza para comparação heurística: minúsculas, só alfanumérico. */
function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isToolDirectory(directoryName: string): boolean {
  return EXE_TOOL_DIRECTORIES.has(normalizeForMatch(directoryName))
}

/**
 * Varre `<installPath>` (profundidade ≤ 2, sem seguir symlinks/reparse
 * points) coletando `*.exe` válidos. Devolve o caminho escolhido ou null.
 */
export function findGameExecutable(installPath: string): string | null {
  const candidates: ExeCandidate[] = []

  const walk = (dir: string, depth: number): void => {
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // pasta sem permissão de leitura — trata como vazia
    }
    for (const entry of entries) {
      // Nunca seguir links (evita apontar para fora da pasta do jogo).
      if (entry.isSymbolicLink()) continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < EXE_SCAN_MAX_DEPTH && !isToolDirectory(entry.name)) walk(fullPath, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
      if (ext !== '.exe') continue
      if (isExcludedExeName(entry.name)) continue
      try {
        const size = statSync(fullPath).size
        candidates.push({ path: fullPath, size, depth })
      } catch {
        // Arquivo ilegível — ignora.
      }
    }
  }

  try {
    if (!statSync(installPath).isDirectory()) return null
  } catch {
    return null
  }
  walk(installPath, 0)

  if (candidates.length === 0) return null

  // Raiz primeiro: o executável "de verdade" quase sempre é o da raiz, e os
  // maiores .exe em subpastas costumam ser ferramentas/redistribuíveis.
  const rootCandidates = candidates.filter((candidate) => candidate.depth === 0)
  const pool = rootCandidates.length > 0 ? rootCandidates : candidates

  // (a) nome do exe relacionado ao nome da pasta de instalação (nos dois
  // sentidos: `Bodycam.exe` ⊂ `Bodycam`, `isaac-ng.exe` ⊂ `Isaac Rebirth`)
  const folderKey = normalizeForMatch(basename(installPath))
  if (folderKey) {
    const folderMatch = pool.find((candidate) => {
      const exeKey = normalizeForMatch(basename(candidate.path, '.exe'))
      if (exeKey.length < 4) return false
      return exeKey.includes(folderKey) || folderKey.includes(exeKey)
    })
    if (folderMatch) return folderMatch.path
  }

  // (b) o *.exe de maior tamanho do pool (quase sempre o binário principal)
  const largest = [...pool].sort((a, b) => b.size - a.size)[0]
  return largest ? largest.path : null
}

/**
 * Deriva a raiz da instalação de um jogo da Steam a partir do caminho salvo
 * (`...\steamapps\common\<installDir>\...`). Devolve null quando o caminho
 * não segue esse formato (ex.: jogo personalizado).
 */
export function steamGameRootFromExe(exePath: string): string | null {
  if (typeof exePath !== 'string') return null
  const normalized = exePath.trim().replace(/\//g, '\\')
  const marker = '\\steamapps\\common\\'
  const index = normalized.toLowerCase().indexOf(marker)
  if (index < 0) return null
  const common = normalized.slice(0, index + marker.length)
  const installDir = normalized.slice(index + marker.length).split('\\')[0]
  if (!installDir) return null
  return join(common, installDir)
}
