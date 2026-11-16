import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  type WriteStream
} from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import treeKill from 'tree-kill'
import { app } from 'electron'
import { splitCommandLine, checkCommandLine } from './commandLine'
import { logger } from './logger'

interface ProcessInfo {
  process: ChildProcess
  appId: string
  status: 'running' | 'stopped' | 'error'
  startedAt: Date
  logs: string[]
  stopping: boolean
  /** Comando/cwd/opções usados no launch — permite o relançamento interno (06-6.4). */
  launch: LaunchContext
  /** Preferência `autoRestart` resolvida no momento do launch (via getAppPrefs injetado). */
  autoRestart: boolean
  /** Timer de relançamento agendado (null quando nenhum pendente). Cancelado em stop()/killAll()/launch(). */
  restartTimer: ReturnType<typeof setTimeout> | null
}

/** Contexto de launch guardado em `ProcessInfo` para relançamento interno. */
export interface LaunchContext {
  command: string
  /** cwd ORIGINAL (antes de resolvePath) — o relançamento re-resolve como um launch novo. */
  cwd: string
  shell?: boolean
  env?: NodeJS.ProcessEnv
}

/** Preferências por app resolvidas pelo chamador (index.ts injeta `getAppPrefs`). */
export interface AppPrefs {
  autoRestart?: boolean
  /** Gravar stdout/stderr do processo em `<userData>/logs/<appId>.log` (opt-in, 05-5.7). */
  persistLogs?: boolean
}

export type GetAppPrefs = (appId: string) => AppPrefs | undefined

/** Tamanho máximo de `<appId>.log` antes da rotação para `<appId>.log.1` (1 MB). */
export const PERSIST_LOG_MAX_BYTES = 1024 * 1024

/** Máximo de relançamentos automáticos por janela deslizante. */
export const AUTO_RESTART_MAX_ATTEMPTS = 3
/** Janela deslizante do limite (10 minutos). */
export const AUTO_RESTART_WINDOW_MS = 10 * 60 * 1000
/** Backoff por ordem da tentativa (2s, 5s, 10s) — decisões confirmadas pelo usuário em 15/11/2026. */
export const AUTO_RESTART_BACKOFF_MS = [2000, 5000, 10000] as const

/** Remove timestamps fora da janela de `windowMs` (e timestamps no futuro). Puro. */
export function pruneAttempts(
  attemptTimestamps: number[],
  now: number,
  windowMs: number = AUTO_RESTART_WINDOW_MS
): number[] {
  return attemptTimestamps.filter((t) => t <= now && now - t < windowMs)
}

/** True se ainda há orçamento de tentativas na janela de `windowMs`. Puro. */
export function shouldAutoRestart(
  attemptTimestamps: number[],
  now: number,
  maxAttempts: number = AUTO_RESTART_MAX_ATTEMPTS,
  windowMs: number = AUTO_RESTART_WINDOW_MS
): boolean {
  return pruneAttempts(attemptTimestamps, now, windowMs).length < maxAttempts
}

/** Backoff conforme a ordem da tentativa: 1ª→2s, 2ª→5s, 3ª+→10s. Puro. */
export function autoRestartBackoffMs(attemptIndex: number): number {
  if (!Number.isFinite(attemptIndex) || attemptIndex < 0) return AUTO_RESTART_BACKOFF_MS[0]
  const idx = Math.floor(attemptIndex)
  return AUTO_RESTART_BACKOFF_MS[Math.min(idx, AUTO_RESTART_BACKOFF_MS.length - 1)]
}

/**
 * Expands `%VAR%` (Windows) / `$VAR` / `~` so the paths saved in Settings can
 * stay portable instead of being hardcoded to this machine.
 */
export function expandPath(value: string): string {
  if (!value) return value

  let result = value.trim()

  if (result === '~') {
    result = homedir()
  } else if (result.startsWith('~/') || result.startsWith('~\\')) {
    result = resolve(homedir(), result.slice(2))
  }

  result = result.replace(/%([^%]+)%/g, (match, name: string) => {
    const envValue = process.env[name]
    return envValue !== undefined ? envValue : match
  })

  return result
}

let baseDir = process.cwd()

/** Sets the directory used to resolve relative paths (app root / install dir). */
export function setBaseDir(dir: string): void {
  baseDir = dir
}

/** Resolves a possibly relative path against the Hub's base directory. */
export function resolvePath(value: string): string {
  return resolve(baseDir, expandPath(value))
}

export interface LaunchOptions {
  /**
   * true (padrão): executa a string inteira via shell (cmd.exe) — preserva
   * aspas e argumentos, mas interpreta metacaracteres (&, |, %FOO%, ...).
   * false: separa a linha em argv e faz spawn sem shell — sem interpretação
   * de shell; ideal para comandos simples e caminhos sem aspas especiais.
   */
  shell?: boolean
  /** Variáveis de ambiente extras (ex.: MARK_LVI_HOME para o Mark LVI). */
  env?: NodeJS.ProcessEnv
}

export class ProcessManager extends EventEmitter {
  private processes: Map<string, ProcessInfo> = new Map()
  /** Timestamps das tentativas de auto-restart por appId (janela deslizante). */
  private restartAttempts: Map<string, number[]> = new Map()
  /** Streams de log em arquivo por appId (só com a pref `persistLogs` ativa). */
  private logStreams: Map<string, WriteStream> = new Map()
  private readonly getAppPrefs: GetAppPrefs
  /** Diretório dos logs por app; quando ausente, resolve `<userData>/logs` na 1ª escrita. */
  private readonly logsDir?: string

  constructor(options: { getAppPrefs?: GetAppPrefs; logsDir?: string } = {}) {
    super()
    // Sem injetor (ex.: testes legados), nada é reiniciado — opt-in por app exige
    // que o index.ts injete um leitor real das preferências (ver getConfigSnapshot).
    this.getAppPrefs = options.getAppPrefs ?? (() => undefined)
    this.logsDir = options.logsDir
  }

  /** Diretório dos logs por app — injetável (testes); default `<userData>/logs`. */
  private resolveLogsDir(): string {
    if (this.logsDir) return this.logsDir
    try {
      return join(app.getPath('userData'), 'logs')
    } catch {
      // Fora do Electron (testes sem mock) — degrada para o cwd, nunca lança.
      return join(process.cwd(), 'logs')
    }
  }

  /** Nome de arquivo seguro para o appId (defesa contra path traversal via IPC). */
  private static logFileName(appId: string): string {
    return `${appId.replace(/[^a-zA-Z0-9._-]/g, '_')}.log`
  }

  /**
   * Rotação 1 MB → `<appId>.log.1` (sobrescreve o anterior; máx. 2 arquivos por app).
   * Best-effort: nunca lança. Quem chama deve ter fechado o stream antes (Windows
   * trava arquivo aberto para rename).
   */
  private rotateLogIfNeeded(logPath: string): void {
    try {
      if (statSync(logPath).size <= PERSIST_LOG_MAX_BYTES) return
      renameSync(logPath, `${logPath}.1`)
    } catch {
      // Arquivo inexistente/ilegível ou rename negado — segue escrevendo no atual.
    }
  }

  /** Abre (append) o stream de log do app; retorna null se o disco falhar. */
  private openLogStream(appId: string): WriteStream | null {
    const dir = this.resolveLogsDir()
    const logPath = join(dir, ProcessManager.logFileName(appId))
    try {
      mkdirSync(dir, { recursive: true })
      // Arquivo já acima de 1 MB de sessões anteriores → rotaciona antes de anexar.
      this.rotateLogIfNeeded(logPath)
      const stream = createWriteStream(logPath, { flags: 'a' })
      // Disco cheio/permissão mudando no meio da sessão: nunca derruba o app.
      stream.on('error', () => {})
      this.logStreams.set(appId, stream)
      return stream
    } catch {
      return null
    }
  }

  /**
   * Grava um chunk no arquivo do app (prefixo `[iso] `), com rotação por tamanho
   * ANTES de escrever. Ring buffer em RAM não é tocado aqui.
   */
  private writeAppLog(appId: string, text: string): void {
    const logPath = join(this.resolveLogsDir(), ProcessManager.logFileName(appId))
    const existing = this.logStreams.get(appId)
    if (!existing) return
    let stream = existing
    try {
      if (statSync(logPath).size > PERSIST_LOG_MAX_BYTES) {
        // Windows não renomeia arquivo com stream aberto: fecha, rotaciona, reabre.
        stream.end()
        this.logStreams.delete(appId)
        try {
          renameSync(logPath, `${logPath}.1`)
        } catch {
          // Sem rotação — a escrita segue no arquivo atual (recriado abaixo).
        }
        const reopened = this.openLogStream(appId)
        if (!reopened) return
        stream = reopened
      }
    } catch {
      // Arquivo ainda não criado (1º write) ou statSync falhou — segue escrevendo.
    }
    stream.write(`[${new Date().toISOString()}] ${text}`)
  }

  /** Escreve a linha de encerramento e fecha o stream do app (idempotente). */
  private finishAppLog(appId: string, line: string): void {
    const stream = this.logStreams.get(appId)
    if (!stream) return
    this.logStreams.delete(appId)
    try {
      stream.write(`[${new Date().toISOString()}] ${line}\n`)
      stream.end()
    } catch {
      // best-effort — o fechamento nunca bloqueia o ciclo de vida do processo
    }
  }

  /** Cancela o timer de auto-restart pendente, se houver. */
  private cancelRestartTimer(info: ProcessInfo): void {
    if (info.restartTimer) {
      clearTimeout(info.restartTimer)
      info.restartTimer = null
    }
  }

  /** Agenda o relançamento se o opt-in estiver ligado e houver orçamento na janela. */
  private maybeScheduleAutoRestart(info: ProcessInfo): void {
    const now = Date.now()
    const attempts = pruneAttempts(this.restartAttempts.get(info.appId) ?? [], now)
    if (!shouldAutoRestart(attempts, now)) {
      this.restartAttempts.set(info.appId, attempts)
      // Não abrir diálogo modal — a UI já colore o card de erro; só o log registra o motivo.
      logger.info(
        'processManager',
        `appId=${info.appId} auto-restart desistido (limite de ${AUTO_RESTART_MAX_ATTEMPTS} tentativas em 10 min)`
      )
      return
    }
    const backoff = autoRestartBackoffMs(attempts.length)
    const nextAttempts = [...attempts, now]
    this.restartAttempts.set(info.appId, nextAttempts)
    info.restartTimer = setTimeout(() => {
      info.restartTimer = null
      this.relaunch(info)
    }, backoff)
    logger.info(
      'processManager',
      `appId=${info.appId} auto-restart #${nextAttempts.length} em ${backoff / 1000}s`
    )
  }

  /** Relança internamente com o MESMO contexto do launch original (reusa launch; não duplica validação). */
  private relaunch(info: ProcessInfo): void {
    const { command, cwd, shell, env } = info.launch
    const result = this.launch(info.appId, command, cwd, { shell, env })
    if (!result.success) {
      logger.error('processManager', `appId=${info.appId} auto-restart falhou: ${result.error}`)
    }
  }

  launch(
    appId: string,
    command: string,
    cwd: string,
    options: LaunchOptions = {}
  ): { success: boolean; error?: string } {
    const useShell = options.shell !== false
    const existing = this.processes.get(appId)
    // Um launch manual (ou o relançamento) invalida qualquer timer pendente —
    // nunca dois relançamentos para a mesma queda.
    if (existing) this.cancelRestartTimer(existing)
    if (existing && existing.status === 'running') {
      return { success: false, error: 'Processo já está em execução' }
    }

    const trimmedCommand = command.trim()
    if (!trimmedCommand) {
      return { success: false, error: 'Nenhum comando configurado' }
    }

    for (const issue of checkCommandLine(trimmedCommand)) {
      // Nunca bloqueia (o comando é configurável de propósito), mas o aviso
      // fica no log do main para facilitar diagnóstico.
      logger.warn('processManager', `appId=${appId} checagem: ${issue.level}: ${issue.message}`)
    }

    const workingDir = cwd.trim() ? resolvePath(cwd) : process.cwd()
    if (!existsSync(workingDir)) {
      return { success: false, error: `Diretório não encontrado: ${workingDir}` }
    }

    try {
      let child: ChildProcess

      if (useShell) {
        // Passar a string inteira para o shell preserva caminhos com aspas
        // e argumentos. ⚠️ O comando é interpretado pelo cmd.exe: quem tiver
        // o comando configurado decide o que executa.
        // Comando completo só em debug: pode conter segredos nos argumentos.
        logger.debug(
          'processManager',
          `appId=${appId} launch via shell:true command="${trimmedCommand}" cwd="${workingDir}"` +
            ' (interpretação pelo cmd.exe — metacaracteres serão avaliados)'
        )
        child = spawn(trimmedCommand, {
          cwd: workingDir,
          shell: true,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, ...options.env }
        })
      } else {
        const argv = splitCommandLine(trimmedCommand)
        if (argv.length === 0) {
          return { success: false, error: 'Nenhum comando configurado' }
        }
        // argv completo só em debug: pode conter segredos nos argumentos.
        logger.debug(
          'processManager',
          `appId=${appId} launch via shell:false argv=${JSON.stringify(argv)} cwd="${workingDir}"` +
            ' (sem interpretação de shell)'
        )
        child = spawn(argv[0], argv.slice(1), {
          cwd: workingDir,
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, ...options.env }
        })
      }

      const prefs = this.getAppPrefs(appId)
      const persistLogs = prefs?.persistLogs === true
      const info: ProcessInfo = {
        process: child,
        appId,
        status: 'running',
        startedAt: new Date(),
        logs: [],
        stopping: false,
        launch: { command: trimmedCommand, cwd, shell: useShell, env: options.env },
        autoRestart: prefs?.autoRestart === true,
        restartTimer: null
      }
      // Opt-in (05-5.7): abre o stream append ANTES de qualquer chunk chegar.
      if (persistLogs) this.openLogStream(appId)

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        info.logs.push(text)
        if (info.logs.length > 1000) info.logs.shift()
        this.writeAppLog(appId, text)
        this.emit('output', appId, text)
      })

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        info.logs.push(`[ERR] ${text}`)
        if (info.logs.length > 1000) info.logs.shift()
        // Mesmo prefixo [ERR] do ring buffer — coerência entre UI e arquivo.
        this.writeAppLog(appId, `[ERR] ${text}`)
        this.emit('output', appId, text)
      })

      child.on('close', (code) => {
        // A process we stopped on purpose must not be reported as an error,
        // even though taskkill makes it exit with a non-zero code.
        info.status = info.stopping ? 'stopped' : code === 0 ? 'stopped' : 'error'
        this.finishAppLog(appId, `[exit code ${code}]`)
        // Auto-restart OPT-IN: só quando o encerramento foi por queda (não pedido
        // pelo Hub) e há orçamento na janela. O timer é guardado em `info` e
        // cancelado por stop()/killAll().
        if (info.status === 'error' && info.autoRestart) {
          this.maybeScheduleAutoRestart(info)
        }
        this.emit('status-change', appId, info.status)
      })

      child.on('error', (err) => {
        info.status = 'error'
        info.logs.push(`[ERROR] ${err.message}`)
        this.finishAppLog(appId, `[ERROR] ${err.message}`)
        this.emit('status-change', appId, 'error')
      })

      this.processes.set(appId, info)
      this.emit('status-change', appId, 'running')

      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  }

  stop(appId: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolveStop) => {
      const info = this.processes.get(appId)
      // Cancela qualquer relaunch pendente ANTES de decidir — `stop()` manual
      // nunca pode ser seguido de ressurreição do app.
      if (info) this.cancelRestartTimer(info)
      if (!info || info.status !== 'running') {
        resolveStop({ success: false, error: 'Processo não está em execução' })
        return
      }

      const pid = info.process.pid
      if (!pid) {
        resolveStop({ success: false, error: 'PID não encontrado' })
        return
      }

      info.stopping = true

      const finish = (): void => {
        info.status = 'stopped'
        this.emit('status-change', appId, 'stopped')
        resolveStop({ success: true })
      }

      treeKill(pid, 'SIGTERM', (err) => {
        if (err) {
          // Force kill if the graceful attempt fails.
          treeKill(pid, 'SIGKILL', () => finish())
        } else {
          finish()
        }
      })
    })
  }

  getStatus(appId: string): { status: string; startedAt?: string; logCount: number } {
    const info = this.processes.get(appId)
    if (!info) {
      return { status: 'stopped', logCount: 0 }
    }
    return {
      status: info.status,
      startedAt: info.startedAt.toISOString(),
      logCount: info.logs.length
    }
  }

  getAllStatus(): Record<string, { status: string; startedAt?: string }> {
    const result: Record<string, { status: string; startedAt?: string }> = {}
    for (const [appId, info] of this.processes) {
      result[appId] = {
        status: info.status,
        startedAt: info.startedAt.toISOString()
      }
    }
    return result
  }

  getLogs(appId: string): string {
    return this.processes.get(appId)?.logs.join('') ?? ''
  }

  killAll(): void {
    for (const [, info] of this.processes) {
      this.cancelRestartTimer(info)
      if (info.status === 'running' && info.process.pid) {
        info.stopping = true
        treeKill(info.process.pid, 'SIGKILL')
        info.status = 'stopped'
        this.emit('status-change', info.appId, 'stopped')
      }
    }
  }
}
