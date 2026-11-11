import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { resolve } from 'path'
import treeKill from 'tree-kill'

interface ProcessInfo {
  process: ChildProcess
  appId: string
  status: 'running' | 'stopped' | 'error'
  startedAt: Date
  logs: string[]
  stopping: boolean
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

export class ProcessManager extends EventEmitter {
  private processes: Map<string, ProcessInfo> = new Map()

  launch(appId: string, command: string, cwd: string): { success: boolean; error?: string } {
    const existing = this.processes.get(appId)
    if (existing && existing.status === 'running') {
      return { success: false, error: 'Processo já está em execução' }
    }

    const trimmedCommand = command.trim()
    if (!trimmedCommand) {
      return { success: false, error: 'Nenhum comando configurado' }
    }

    const workingDir = cwd.trim() ? resolvePath(cwd) : process.cwd()
    if (!existsSync(workingDir)) {
      return { success: false, error: `Diretório não encontrado: ${workingDir}` }
    }

    try {
      // Passing the whole command string to the shell preserves quoted paths
      // and arguments (e.g. "C:\Program Files\App\app.exe" --flag).
      const child = spawn(trimmedCommand, {
        cwd: workingDir,
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
      })

      const info: ProcessInfo = {
        process: child,
        appId,
        status: 'running',
        startedAt: new Date(),
        logs: [],
        stopping: false
      }

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        info.logs.push(text)
        if (info.logs.length > 1000) info.logs.shift()
        this.emit('output', appId, text)
      })

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        info.logs.push(`[ERR] ${text}`)
        if (info.logs.length > 1000) info.logs.shift()
        this.emit('output', appId, text)
      })

      child.on('close', (code) => {
        // A process we stopped on purpose must not be reported as an error,
        // even though taskkill makes it exit with a non-zero code.
        info.status = info.stopping ? 'stopped' : code === 0 ? 'stopped' : 'error'
        this.emit('status-change', appId, info.status)
      })

      child.on('error', (err) => {
        info.status = 'error'
        info.logs.push(`[ERROR] ${err.message}`)
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
      if (info.status === 'running' && info.process.pid) {
        info.stopping = true
        treeKill(info.process.pid, 'SIGKILL')
        info.status = 'stopped'
        this.emit('status-change', info.appId, 'stopped')
      }
    }
  }
}
