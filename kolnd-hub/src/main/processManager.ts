import { spawn, spawnSync, ChildProcess } from 'child_process'
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
  /**
   * Resolve quando o filho REALMENTE saiu (evento `close`, com fallback em `error`).
   * O callback do tree-kill não serve para isso: ele confirma que o taskkill
   * retornou, não que o processo filho morreu.
   */
  exited: Promise<void>
  /** Chamado uma única vez no `close`/`error` — promises só resolvem (idempotente). */
  resolveExited: () => void
  /** Stop em andamento: chamadas concorrentes no mesmo appId compartilham a operação. */
  stopPromise: Promise<StopResult> | null
}

/** Resultado de stop(): `success` só quando o filho confirmou a saída. */
export interface StopResult {
  success: boolean
  error?: string
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

/**
 * Espera pela saída real após o SIGTERM. O callback do tree-kill dispara quando
 * o taskkill termina, não quando o filho morre — daí a espera pelo evento `close`.
 */
export const STOP_GRACE_MS = 3000
/**
 * Deadline do próprio tree-kill. Se o helper travar (taskkill preso, psTree
 * pendurado) o callback nunca chega; sem esse limite o stop() ficaria pendurado
 * para sempre e o IPC app:stop nunca responderia. Quem decide se parou é
 * `info.exited`, não o retorno do helper.
 */
export const TREE_KILL_TIMEOUT_MS = 2000
/** Espera extra após o SIGKILL antes de admitir que o filho não saiu. */
export const STOP_FORCE_TIMEOUT_MS = 2000
/**
 * Deadline total do killAll() no quit: acima disso os sobreviventes levam um
 * force-kill síncrono. O quit nunca pode ficar preso a um filho travado.
 */
export const KILL_ALL_DEADLINE_MS = 5000

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
  /** Variáveis de ambiente extras para o processo filho. */
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
      // Launch novo no mesmo appId sem close anterior (defesa de segunda
      // instância): fecha o stream antigo para não vazar handle nem misturar
      // sessões no mesmo arquivo.
      this.logStreams.get(appId)?.end()
      this.logStreams.delete(appId)
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

  /**
   * Dispara o tree-kill e resolve quando o helper retorna — NÃO quando o filho
   * morre. Por isso todo encerramento espera `info.exited`. Erro do tree-kill
   * (PID inválido, helper ausente) nunca rejeita: quem chama decide pelo `exited`.
   * O deadline cobre o caso de o helper nunca chamar o callback (taskkill/psTree
   * travado), que prenderia o stop() e o IPC app:stop indefinidamente. Callback
   * e timeout podem resolver a mesma promise — resolve é idempotente.
   */
  private sendTreeKill(pid: number, signal: string): Promise<void> {
    return new Promise((resolveKill) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      const done = (): void => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        resolveKill()
      }
      timer = setTimeout(done, TREE_KILL_TIMEOUT_MS)
      try {
        treeKill(pid, signal, () => done())
      } catch {
        done()
      }
    })
  }

  /**
   * Espera `promise` até `timeoutMs`; devolve true se terminou a tempo.
   * O timer é sempre limpo para não segurar o event loop depois da corrida.
   */
  private waitWithTimeout(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<boolean>((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout(false), timeoutMs)
    })
    return Promise.race([promise.then(() => true), timeout]).finally(() => {
      if (timer) clearTimeout(timer)
    })
  }

  /** Aguarda a saída real do filho (evento close) dentro da janela informada. */
  private waitForExit(info: ProcessInfo, timeoutMs: number): Promise<boolean> {
    return this.waitWithTimeout(info.exited, timeoutMs)
  }

  /**
   * Force-kill SÍNCRONO da árvore. Usado no caminho de crash (event loop pode
   * morrer em seguida) e como rede de segurança do quit. Nunca lança.
   */
  private forceKillTreeSync(pid: number): void {
    try {
      if (process.platform === 'win32') {
        // taskkill /T /F derruba o filho e toda a árvore sem depender do event loop.
        spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
        return
      }
      // Fora do Windows não há taskkill: tenta o grupo (filho líder) e o PID.
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // Sem grupo próprio (spawn não-detached) — o kill direto abaixo resolve.
      }
      process.kill(pid, 'SIGKILL')
    } catch {
      // Caminho de crash/limpeza: best-effort e jamais pode lançar.
    }
  }

  /**
   * Defesa contra segunda instância: um registro fora de `running` ainda pode
   * ter filho vivo (stop() que estourou o deadline, `error` com close pendente).
   * Sem isso, o próximo launch criaria um segundo processo do mesmo app.
   */
  private killPreviousTreeIfAlive(info: ProcessInfo): void {
    const pid = info.process.pid
    if (!pid || info.process.exitCode !== null) return
    logger.warn(
      'processManager',
      `appId=${info.appId} filho anterior ainda vivo (pid=${pid}) — force-kill antes do relaunch`
    )
    this.forceKillTreeSync(pid)
  }

  /**
   * Encerramento pedido por stop(): SIGTERM, espera a saída REAL, escala para
   * SIGKILL e espera de novo. Só resolve `success: true` depois do `close`.
   */
  private async performStop(info: ProcessInfo, pid: number): Promise<StopResult> {
    if (info.process.exitCode === null) {
      await this.sendTreeKill(pid, 'SIGTERM')
      if (await this.waitForExit(info, STOP_GRACE_MS)) return { success: true }

      // Taskkill retornou mas o filho segue vivo: escala. Sem essa confirmação
      // o Hub mentiria "parado" para um processo ainda em execução.
      logger.warn(
        'processManager',
        `appId=${info.appId} pid=${pid} não saiu em ${STOP_GRACE_MS}ms após SIGTERM — escalando para SIGKILL`
      )
      await this.sendTreeKill(pid, 'SIGKILL')
      if (await this.waitForExit(info, STOP_FORCE_TIMEOUT_MS)) return { success: true }
    } else if (await this.waitForExit(info, STOP_GRACE_MS)) {
      // Já estava saindo quando stop() chegou: aguarda o close em vez de falhar.
      return { success: true }
    }

    // Nunca alegar parada sem o evento close — quem chamou pode tentar de novo.
    return {
      success: false,
      error: `Processo não confirmou a saída (pid=${pid})`
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

    // Um registro não-running ainda pode ter filho vivo: mata a árvore antes
    // de spawnar para nunca existirem duas instâncias do mesmo app.
    if (existing) this.killPreviousTreeIfAlive(existing)

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
      let resolveExited: () => void = () => {}
      const exited = new Promise<void>((resolvePromise) => {
        resolveExited = () => resolvePromise()
      })
      const info: ProcessInfo = {
        process: child,
        appId,
        status: 'running',
        startedAt: new Date(),
        logs: [],
        stopping: false,
        launch: { command: trimmedCommand, cwd, shell: useShell, env: options.env },
        autoRestart: prefs?.autoRestart === true,
        restartTimer: null,
        exited,
        resolveExited,
        stopPromise: null
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
        // O handler de close é o DONO da transição final: stop() espera
        // `info.exited` e não emite status-change por conta própria.
        info.status = info.stopping ? 'stopped' : code === 0 ? 'stopped' : 'error'
        // Depois do relaunch o map pode apontar para outro ProcessInfo: efeitos
        // compartilhados (log/evento/auto-restart) pertencem ao launch atual.
        const isCurrent = this.processes.get(appId) === info
        if (isCurrent) this.finishAppLog(appId, `[exit code ${code}]`)
        // Auto-restart OPT-IN: só quando o encerramento foi por queda (não pedido
        // pelo Hub) e há orçamento na janela. O timer é guardado em `info` e
        // cancelado por stop()/killAll().
        if (isCurrent && info.status === 'error' && info.autoRestart) {
          this.maybeScheduleAutoRestart(info)
        }
        if (isCurrent) this.emit('status-change', appId, info.status)
        // Resolve por último: quem aguarda stop() já vê status/log/evento finais.
        info.resolveExited()
      })

      child.on('error', (err) => {
        info.status = 'error'
        info.logs.push(`[ERROR] ${err.message}`)
        if (this.processes.get(appId) === info) {
          this.finishAppLog(appId, `[ERROR] ${err.message}`)
          this.emit('status-change', appId, 'error')
        }
        // Fallback: um spawn que nunca chega a 'close' não pode deixar stop() preso.
        info.resolveExited()
      })

      this.processes.set(appId, info)
      this.emit('status-change', appId, 'running')

      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  }

  stop(appId: string): Promise<StopResult> {
    const info = this.processes.get(appId)
    // Cancela qualquer relaunch pendente ANTES de decidir — `stop()` manual
    // nunca pode ser seguido de ressurreição do app.
    if (info) this.cancelRestartTimer(info)
    if (!info || info.status !== 'running') {
      return Promise.resolve({ success: false, error: 'Processo não está em execução' })
    }

    // Stop concorrente no mesmo appId compartilha a MESMA operação: um único
    // tree-kill e uma única confirmação de saída para todos os chamadores.
    if (info.stopPromise) return info.stopPromise

    const pid = info.process.pid
    if (!pid) {
      return Promise.resolve({ success: false, error: 'PID não encontrado' })
    }

    // `stopping` desliga o auto-restart e faz o handler de close reportar
    // 'stopped' (taskkill sai com código ≠ 0 de propósito).
    info.stopping = true

    const operation = this.performStop(info, pid)
    info.stopPromise = operation
    void operation.then(() => {
      if (info.stopPromise === operation) info.stopPromise = null
    })
    return operation
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

  /**
   * Encerra todos os processos para o quit: cancela timers de restart, dispara
   * SIGKILL em paralelo (sem espera graciosa — o app está saindo) e AGUARDA a
   * saída real de cada filho, com deadline total. Nunca rejeita.
   */
  async killAll(): Promise<void> {
    try {
      const pending: Array<Promise<void>> = []
      for (const info of this.processes.values()) {
        this.cancelRestartTimer(info)
        const pid = info.process.pid
        // Encerra qualquer filho que ainda possa estar vivo — inclusive um
        // registro fora de `running` com close atrasado (nunca deixar órfão).
        if (!pid || info.process.exitCode !== null) continue
        info.stopping = true
        // SIGKILL direto: no quit não há tempo para o pedido gracioso.
        void this.sendTreeKill(pid, 'SIGKILL')
        pending.push(info.exited)
      }

      if (pending.length > 0) {
        // Deadline total: um filho travado não pode segurar o quit para sempre.
        await this.waitWithTimeout(Promise.all(pending), KILL_ALL_DEADLINE_MS)

        // Sobreviventes do deadline: force-kill síncrono para não deixar órfãos.
        for (const info of this.processes.values()) {
          const pid = info.process.pid
          if (pid && info.process.exitCode === null) {
            this.forceKillTreeSync(pid)
          }
        }
      }
    } catch {
      // Best-effort: o encerramento do Hub nunca falha por causa de um filho.
    }
  }

  /**
   * Limpeza do caminho de crash: mata a árvore de todos os filhos de forma
   * SÍNCRONA (o event loop pode morrer logo depois) e marca `stopped` para
   * manter a semântica de `stopping`. Jamais lança.
   */
  killAllSync(): void {
    for (const info of this.processes.values()) {
      try {
        this.cancelRestartTimer(info)
        info.stopping = true
        const pid = info.process.pid
        // Só tenta matar quem ainda pode estar vivo (exitCode null).
        if (pid && info.process.exitCode === null) {
          this.forceKillTreeSync(pid)
        }
        if (info.status !== 'stopped') {
          info.status = 'stopped'
          this.emit('status-change', info.appId, 'stopped')
        }
      } catch {
        // Caminho de crash: a limpeza é best-effort e nunca pode lançar.
      }
    }
  }
}
