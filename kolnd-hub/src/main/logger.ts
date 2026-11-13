import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs'
import { basename, dirname, extname, join } from 'path'

/** Níveis de log do processo main. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_VALUE: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_KEEP = 2 // kolnd-hub.1.log e kolnd-hub.2.log (total de 3 arquivos, ~15 MB)
const REDACTED = '[redigido]'

// Comandos completos (command=/argv=/...) e segredos óbvios (token=, password=, ...)
// nunca vão para o arquivo em info+. Em debug nada é mascarado.
const COMMAND_RE = /(command|cmd|argv|args)\s*=\s*(?:"[^"]*"|'[^']*'|\[[^\]]*\]|\S+)/gi
const SECRET_RE =
  /(password|passwd|pwd|token|secret|api[-_]?key|senha|chave)(\s*[=:]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi

/** Redação mínima: em `debug` retorna o texto intacto; em `info`+ mascara comandos e segredos. */
export function redactForLevel(level: LogLevel, text: string): string {
  if (level === 'debug') return text
  return text.replace(COMMAND_RE, `$1=${REDACTED}`).replace(SECRET_RE, `$1$2${REDACTED}`)
}

/** Formata a linha `[ISO] [NÍVEL] [escopo] mensagem`. */
export function formatLogLine(
  level: LogLevel,
  scope: string,
  message: string,
  now: Date = new Date()
): string {
  return `[${now.toISOString()}] [${level.toUpperCase()}] [${scope}] ${message}`
}

function numberedLogPath(logPath: string, index: number): string {
  const ext = extname(logPath)
  return join(dirname(logPath), `${basename(logPath, ext)}.${index}${ext}`)
}

/**
 * Rotação por tamanho: se `logPath` atingiu `maxBytes`, descarta o arquivo mais
 * antigo, renomeia os demais (.1 → .2, ...) e `logPath` → .1. Best-effort: nunca lança.
 */
export function rotateIfNeeded(
  logPath: string,
  maxBytes: number = DEFAULT_MAX_BYTES,
  keep: number = DEFAULT_KEEP
): void {
  let size: number
  try {
    size = statSync(logPath).size
  } catch {
    return // arquivo inexistente (ou ilegível) — nada a rotacionar
  }
  if (size < maxBytes) return
  try {
    const oldest = numberedLogPath(logPath, keep)
    if (existsSync(oldest)) unlinkSync(oldest)
  } catch {
    // best-effort: segue mesmo se não conseguir descartar o mais antigo
  }
  for (let i = keep - 1; i >= 1; i -= 1) {
    try {
      const from = numberedLogPath(logPath, i)
      if (existsSync(from)) renameSync(from, numberedLogPath(logPath, i + 1))
    } catch {
      // best-effort: segue para os demais arquivos
    }
  }
  try {
    renameSync(logPath, numberedLogPath(logPath, 1))
  } catch {
    // best-effort: a escrita seguinte recria kolnd-hub.log
  }
}

/** Serializa argumentos extras: Error → stack em linhas subsequentes indentadas; objetos → JSON seguro. */
function serializeArg(arg: unknown): string {
  if (arg instanceof Error) {
    const text = arg.stack ?? `${arg.name}: ${arg.message}`
    return `\n    ${text.split('\n').join('\n    ')}`
  }
  if (typeof arg === 'string') return arg
  try {
    return JSON.stringify(arg) ?? String(arg)
  } catch {
    return String(arg)
  }
}

/** Nível mínimo: `info` por padrão; `debug` só via KOLND_HUB_LOG_LEVEL=debug. */
function minLevel(): LogLevel {
  const raw = (process.env.KOLND_HUB_LOG_LEVEL ?? '').trim().toLowerCase()
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw
  return 'info'
}

/** Hook exclusivo para testes: força o caminho do arquivo de log (null = padrão). */
let testLogPath: string | null = null
export function setLogPathForTests(path: string | null): void {
  testLogPath = path
}

/** Resolve `%APPDATA%\kolnd-hub\logs\kolnd-hub.log` preguiçosamente (seguro antes do app pronto). */
function resolveLogPath(): string | null {
  if (testLogPath) return testLogPath
  try {
    return join(app.getPath('userData'), 'logs', 'kolnd-hub.log')
  } catch {
    return null // ex.: fora do Electron (testes) — degrada para console
  }
}

function write(level: LogLevel, scope: string, message: unknown, args: unknown[]): void {
  if (LEVEL_VALUE[level] < LEVEL_VALUE[minLevel()]) return
  const text = [message, ...args].map(serializeArg).join(' ')
  const line = formatLogLine(level, scope, redactForLevel(level, text))
  // Espelha no console (comportamento atual do app; também é o degrade quando o disco falha).
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  try {
    sink(line)
  } catch {
    // console indisponível — segue para o arquivo
  }
  const target = resolveLogPath()
  if (!target) return
  try {
    mkdirSync(dirname(target), { recursive: true })
    rotateIfNeeded(target)
    appendFileSync(target, `${line}\n`, 'utf8')
  } catch (err) {
    // Falha de disco NUNCA derruba o app: degrada para console e segue.
    try {
      console.error('[logger] Falha ao gravar log em disco (degrade para console):', err)
    } catch {
      // nada mais a fazer — nunca lançar
    }
  }
}

/** Logger do processo main. Escrita em disco é best-effort e nunca lança. */
export const logger = {
  debug: (scope: string, message: unknown, ...args: unknown[]) =>
    write('debug', scope, message, args),
  info: (scope: string, message: unknown, ...args: unknown[]) =>
    write('info', scope, message, args),
  warn: (scope: string, message: unknown, ...args: unknown[]) =>
    write('warn', scope, message, args),
  error: (scope: string, message: unknown, ...args: unknown[]) =>
    write('error', scope, message, args)
}
