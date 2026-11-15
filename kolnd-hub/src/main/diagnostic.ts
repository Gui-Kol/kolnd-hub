import { app } from 'electron'
import { closeSync, existsSync, openSync, readSync, statSync } from 'fs'
import { release } from 'os'
import { join } from 'path'
import {
  getBigPicturePrefs,
  getConfigSnapshot,
  getGamepadConfig,
  getLaunchKloudOnStart,
  getStoredGames
} from './store'
import { getKloudGamesInstallLogPath, getKloudGamesUninstallLogPath } from './kloudGames'

/**
 * Diagnóstico sanitizado do Hub (task 06-6.3).
 *
 * Monta um relatório em texto puro (pt-BR) para suporte: versões, contagens
 * e metadados do store (NUNCA comandos, cwd, URLs, tags ou nomes de jogos) e
 * as últimas linhas dos logs. TODO o corpo passa por `redactSecrets()` —
 * inclusive as linhas de log. Nenhum arquivo é enviado a lugar nenhum:
 * o texto vai para a área de transferência via IPC `diagnostic:export`.
 */

const REDACTED = '[redigido]'
const TAIL_LINES = 200
const MAX_TAIL_BYTES = 256 * 1024 // 256 KB — nunca ler logs inteiros na main

// Rótulos de segredo cobertos pela redação (nunca saem no relatório).
const SECRET_KEY = String.raw`(?:api[-_]?key|token|secret|senha|password|passwd|pwd|authorization|chave)`
const SECRET_RE = new RegExp(
  String.raw`(${SECRET_KEY}\s*[=:]\s*(?:bearer\s+|basic\s+)?)` +
    String.raw`(?:"[^"]*"|'[^']*'|[A-Za-z0-9+/=._%-]{8,}|\S+)`,
  'gi'
)

/** Redação pura de segredos: `rótulo: valor` / `rótulo=valor` → `rótulo: [redigido]`. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_RE, `$1${REDACTED}`)
}

/** Versões e caminhos do ambiente — sem I/O de arquivo além do userData/crashDumps. */
export function collectSystemInfo(): string[] {
  const lines: string[] = []
  lines.push(`Versão do app: ${safe(() => app.getVersion()) ?? 'indisponível'}`)
  lines.push(`Electron: ${process.versions.electron ?? 'indisponível'}`)
  lines.push(`Chrome: ${process.versions.chrome ?? 'indisponível'}`)
  lines.push(`Node.js: ${process.versions.node ?? 'indisponível'}`)
  const windows =
    typeof process.getSystemVersion === 'function' ? safe(() => process.getSystemVersion()) : null
  lines.push(`Windows: ${windows ?? release()}`)
  lines.push(`Arquitetura: ${process.arch}`)
  lines.push(`userData: ${safe(() => app.getPath('userData')) ?? 'indisponível'}`)
  const crashDumps = safe(() => app.getPath('crashDumps'))
  if (crashDumps) {
    lines.push(`Minidumps de crash locais: ${crashDumps}`)
  }
  return lines
}

/**
 * Contagens e metadados do store — NUNCA valores brutos de `command`, `cwd`,
 * `url`, `tags` ou nomes de jogos. Por app: `id · categoria · useShell`.
 */
export function collectStoreSummary(): string[] {
  const lines: string[] = []
  const snapshot = safe(() => getConfigSnapshot())
  const apps = snapshot?.apps ?? []
  const importance = snapshot?.startupImportance ?? {}
  const games = safe(() => getStoredGames()) ?? []

  lines.push(`Apps configurados: ${apps.length}`)
  lines.push(`Jogos na biblioteca: ${games.length}`)
  const importanceCount = Object.keys(importance).length
  lines.push(`Importâncias configuradas: ${importanceCount}`)
  if (importanceCount > 0) {
    const levels = ['critico', 'recomendado', 'opcional', 'inutil'] as const
    const breakdown = levels
      .map((level) => {
        const count = Object.values(importance).filter((v) => v === level).length
        return `${level}: ${count}`
      })
      .join(', ')
    lines.push(`  (${breakdown})`)
  }
  lines.push(`launchKloudOnStart: ${getLaunchKloudOnStart() ? 'sim' : 'não'}`)
  lines.push(`Controle (Big Picture) configurado: ${getGamepadConfig() ? 'sim' : 'não'}`)
  const sounds = safe(() => getBigPicturePrefs())?.sounds ?? true
  lines.push(`Big Picture — efeitos sonoros: ${sounds ? 'ativados' : 'desativados'}`)

  if (apps.length > 0) {
    lines.push('Apps (id · categoria · useShell):')
    for (const appConfig of apps) {
      lines.push(
        `- ${appConfig.id} · ${appConfig.category} · useShell: ${appConfig.useShell !== false ? 'sim' : 'não'}`
      )
    }
  }
  return lines
}

/**
 * Lê apenas o FINAL do arquivo (últimos `maxBytes`) e devolve as últimas
 * `lines` linhas. Arquivo ausente/ilegível → string vazia (nunca lança).
 */
export function readTail(file: string, lines = TAIL_LINES, maxBytes = MAX_TAIL_BYTES): string {
  let fd: number | null = null
  try {
    if (!existsSync(file)) return ''
    const size = statSync(file).size
    const start = Math.max(0, size - maxBytes)
    const length = size - start
    fd = openSync(file, 'r')
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, start)
    const text = buffer.toString('utf8')
    // Se começamos no meio de uma linha, descarta o fragmento inicial.
    const body = start > 0 ? text.slice(text.indexOf('\n') + 1) : text
    const allLines = body.split('\n')
    return allLines.slice(-lines).join('\n').trimEnd()
  } catch {
    return ''
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // best-effort
      }
    }
  }
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn()
  } catch {
    return null
  }
}

function hubLogPath(): string | null {
  const dir = safe(() => app.getPath('userData'))
  return dir ? join(dir, 'logs', 'kolnd-hub.log') : null
}

function logSection(label: string, file: string | null): string[] {
  if (!file || !existsSync(file)) {
    return [`### ${label}`, `(${label} ausente)`, '']
  }
  const tail = readTail(file)
  if (!tail) {
    return [`### ${label}`, '(arquivo vazio)', '']
  }
  return [`### ${label}`, tail, '']
}

/** Monta o relatório completo (pt-BR) e aplica `redactSecrets` a TODO o corpo. */
export function buildDiagnosticReport(): string {
  const sections: string[] = []
  sections.push(`Kolnd Hub ${safe(() => app.getVersion()) ?? 'indisponível'} — Diagnóstico`)
  sections.push(`Gerado em: ${new Date().toISOString()}`)
  sections.push('')
  sections.push('## Sistema')
  sections.push(...collectSystemInfo())
  sections.push('')
  sections.push('## Store (contagens e metadados)')
  sections.push(...collectStoreSummary())
  sections.push('')
  sections.push('## Logs (últimas 200 linhas)')
  sections.push(...logSection('kolnd-hub.log', hubLogPath()))
  sections.push(
    ...logSection(
      'kloud-games-install.log',
      safe(() => getKloudGamesInstallLogPath())
    )
  )
  sections.push(
    ...logSection(
      'kloud-games-uninstall.log',
      safe(() => getKloudGamesUninstallLogPath())
    )
  )
  sections.push('## Aviso')
  sections.push(
    'Este diagnóstico não contém comandos, caminhos pessoais nem chaves. Revise antes de colar em um ticket público.'
  )
  return redactSecrets(sections.join('\n'))
}
