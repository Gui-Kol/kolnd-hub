import { app, dialog, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { execFile, spawn } from 'child_process'
import { randomUUID } from 'crypto'
import {
  access,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile
} from 'fs/promises'
import { join } from 'path'
import type { ActionToolsEnv } from './tools'
import type { AuditContext, AuditEvent, ToolCallResult } from '../gemini/tools/router'
import { createLoggerAudit, routeToolCall } from '../gemini/tools/router'
import { createToolRegistry, type ToolRegistry } from '../gemini/tools/registry'
import {
  createDialogConfirmation,
  type ConfirmationDialogOptions
} from '../gemini/tools/confirmation'
import { createInternalTools, type ToolHandler } from '../gemini/tools/internal'
import type { GeminiFunctionCall } from '../gemini/transport'
import type { IpcContext } from '../ipc/lifecycle'
import { logger } from '../logger'
import { registerShutdownHook } from '../shutdown'
import { getStoreSnapshot, setStoreValue } from '../store'
import {
  createActionAuditWriter,
  createActionLimiter,
  createActionPermissionGate,
  hashActionArgs,
  sanitizeSafeArgs,
  setPaused,
  type PermissionStoreLike
} from '../audit/actions'
import {
  createRoutineScheduler,
  type RoutineAuditEvent,
  type RoutineScheduler
} from '../routines/scheduler'
import { createAppCatalog } from './appCatalog'
import { closeProcess, listProcesses, parseTasklistCsv } from './processes'
import { searchFiles, defaultSearchRoots } from './search'
import { readTextFile } from './readFile'
import { applyFileOps, planFileOps, undoFileOp } from './fileOps'
import { createSystemActions } from './system'
import { createUiAutomation } from './uia'
import { createActionToolEntries, registerActionTools } from './tools'
import { registerPauseShortcut, unregisterPauseShortcut } from './shortcut'

/**
 * Composição de produção das ações (task 08, T10).
 *
 * Só este arquivo liga as implementações ao Electron: `execFile`/`spawn` com
 * `shell:false`, `dialog`, `shell.trashItem`, store, logger e o balão da
 * bandeja. Os testes montam cada módulo com fakes e nunca chegam aqui.
 */

interface CommandResult {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

const MAX_EXEC_BUFFER = 2 * 1024 * 1024

function runCommand(file: string, args: string[], timeoutMs = 30_000): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: MAX_EXEC_BUFFER,
        shell: false
      },
      (err, stdout, stderr) => {
        const error = err as (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null
        const code =
          err === null
            ? 0
            : typeof error?.code === 'number'
              ? error.code
              : typeof error?.code === 'string'
                ? Number.parseInt(error.code, 10) || 1
                : 1
        resolve({
          code,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          timedOut: error?.killed === true
        })
      }
    )
  })
}

async function readPrefix(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const SHORTCUT_RESOLVE_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  '$shell=New-Object -ComObject WScript.Shell',
  '$out=@()',
  'foreach ($p in $args) {',
  '  try {',
  '    $s=$shell.CreateShortcut($p)',
  '    if ($s.TargetPath) { $out += [pscustomobject]@{ path=$p; target=$s.TargetPath } }',
  '  } catch {}',
  '}',
  'ConvertTo-Json -Compress -Depth 4 -InputObject @($out)'
].join('\n')

export interface ActionsRuntime {
  registry: ToolRegistry
  handlers: Map<string, ToolHandler>
  scheduler: RoutineScheduler
  route: (call: GeminiFunctionCall) => Promise<ToolCallResult>
  setNotifier: (notify: (message: string) => void) => void
}

let runtime: ActionsRuntime | null = null

function startMenuDirs(): string[] {
  const dirs: string[] = []
  if (process.env.ProgramData) {
    dirs.push(join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  }
  if (process.env.APPDATA) {
    dirs.push(join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  }
  return dirs
}

function userPath(name: 'documents' | 'desktop' | 'downloads' | 'home'): string {
  try {
    return app.getPath(name)
  } catch {
    return ''
  }
}

export function createActionsRuntime(ctx: IpcContext): ActionsRuntime {
  const userData = app.getPath('userData')
  const roots = defaultSearchRoots({
    documents: userPath('documents'),
    desktop: userPath('desktop'),
    downloads: userPath('downloads')
  }).filter(Boolean)
  const auditDir = join(userData, 'audit')
  const auditWriter = createActionAuditWriter({ dir: auditDir })
  const limiter = createActionLimiter({ now: () => Date.now() })

  const permissionStore: PermissionStoreLike = {
    read: () => getStoreSnapshot().permissions,
    write: (next) => setStoreValue('permissions', next)
  }
  const getPermission = createActionPermissionGate(permissionStore)

  let notifier: (message: string) => void = (message) => logger.info('actions', message)

  const catalog = createAppCatalog({
    cachePath: join(userData, 'app-catalog.json'),
    startMenuDirs: startMenuDirs(),
    fs: { readdir, stat, readFile, writeFile, mkdir },
    resolveShortcuts: async (paths) => {
      const result = await runCommand('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        SHORTCUT_RESOLVE_SCRIPT,
        ...paths
      ])
      if (!result.stdout.trim()) return []
      try {
        const parsed: unknown = JSON.parse(result.stdout)
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (item): item is { path: string; target: string } =>
              Boolean(item) &&
              typeof item === 'object' &&
              typeof (item as Record<string, unknown>).path === 'string' &&
              typeof (item as Record<string, unknown>).target === 'string'
          )
        }
        if (parsed && typeof parsed === 'object') {
          const raw = parsed as Record<string, unknown>
          if (typeof raw.path === 'string' && typeof raw.target === 'string') {
            return [{ path: raw.path, target: raw.target }]
          }
        }
        return []
      } catch {
        return []
      }
    },
    spawn: (file, args, options) => spawn(file, args, options),
    isProcessAlive: async (pid) => {
      const result = await runCommand(
        'tasklist.exe',
        ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        15_000
      )
      if (result.code !== 0) return false
      return parseTasklistCsv(result.stdout).some((process) => process.pid === pid)
    }
  })

  const processes = {
    list: () => listProcesses({ run: runCommand }),
    close: (pid: number, force: boolean) =>
      closeProcess({ run: runCommand, wait: (ms) => new Promise((r) => setTimeout(r, ms)) }, pid, {
        force
      })
  }

  const system = createSystemActions({
    run: runCommand,
    getPermission: () => getPermission('system.power'),
    notify: (message) => notifier(message)
  })

  const uia = createUiAutomation({
    runScript: async (script, args, timeoutMs) => {
      const result = await runCommand(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script, ...args],
        timeoutMs + 2_000
      )
      return { stdout: result.stdout, timedOut: result.timedOut }
    },
    getPermission: () => getPermission('uia.control')
  })

  const dialogOptions = (options: ConfirmationDialogOptions): Promise<{ response: number }> => {
    const overlay = ctx.getOverlayWindow()
    return overlay && !overlay.isDestroyed()
      ? dialog.showMessageBox(overlay as BrowserWindow, options)
      : dialog.showMessageBox(options)
  }
  const confirm = createDialogConfirmation(
    { showMessageBox: (_window, options) => dialogOptions(options) },
    () => ctx.getOverlayWindow()
  )

  const confirmForceClose = async (pid: number): Promise<boolean> => {
    try {
      const result = await dialogOptions({
        type: 'warning',
        title: 'Absolem - forçar encerramento',
        message: `Forçar o encerramento do processo ${pid}?`,
        detail:
          'O programa não fechou em 5 s. Forçar (/T /F) descarta alterações não salvas e ' +
          'encerra também os processos filhos.',
        buttons: ['Cancelar', 'Forçar encerramento'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      return result.response === 1
    } catch {
      return false
    }
  }

  const confirmPlan = async (plan: { summary: string }): Promise<boolean> => {
    try {
      const detail =
        plan.summary.length > 1_500 ? `${plan.summary.slice(0, 1_500)}...` : plan.summary
      const result = await dialogOptions({
        type: 'warning',
        title: 'Absolem - organizar arquivos',
        message: 'Confirma executar este plano?',
        detail,
        buttons: ['Cancelar', 'Executar plano'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      return result.response === 1
    } catch {
      return false
    }
  }

  const env: ActionToolsEnv = {
    catalog,
    processes,
    search: (input) => searchFiles({ fs: { readdir }, allowedRoots: roots }, input),
    readFile: (input) =>
      readTextFile(
        {
          fs: { realpath, stat, readPrefix },
          roots
        },
        input
      ),
    planFileOps: (input) =>
      planFileOps(
        {
          fs: {
            realpath,
            lstat,
            stat,
            exists,
            rename,
            copyFile,
            readFile,
            writeFile,
            mkdir,
            unlink
          },
          roots,
          journalDir: join(userData, 'file-ops'),
          trashItem: (path) => shell.trashItem(path)
        },
        input
      ),
    applyFileOps: (plan) =>
      applyFileOps(
        {
          fs: {
            realpath,
            lstat,
            stat,
            exists,
            rename,
            copyFile,
            readFile,
            writeFile,
            mkdir,
            unlink
          },
          roots,
          journalDir: join(userData, 'file-ops'),
          trashItem: (path) => shell.trashItem(path),
          uuid: randomUUID
        },
        plan
      ),
    undoFileOp: (id) =>
      undoFileOp(
        {
          fs: {
            realpath,
            lstat,
            stat,
            exists,
            rename,
            copyFile,
            readFile,
            writeFile,
            mkdir,
            unlink
          },
          roots,
          journalDir: join(userData, 'file-ops'),
          trashItem: (path) => shell.trashItem(path)
        },
        id
      ),
    system,
    uia,
    limiter,
    confirmForceClose,
    confirmPlan
  }

  const registry = createToolRegistry()
  const handlers = new Map<string, ToolHandler>()
  // Ferramenta interna da task 05 (hora atual): leitura sem efeito, útil para
  // provar o loop modelo → ferramenta → modelo sem tocar no computador.
  for (const entry of createInternalTools({ now: () => new Date() })) {
    const registered = registry.registerTool(entry.definition)
    if (registered.ok) handlers.set(entry.definition.name, entry.handler)
  }
  const registration = registerActionTools(registry, handlers, createActionToolEntries(env))
  for (const error of registration.errors) logger.error('actions', `registro recusado: ${error}`)

  const loggerAudit = createLoggerAudit(logger)
  const audit = (event: AuditEvent, context?: AuditContext): void => {
    loggerAudit(event)
    auditWriter.write({
      at: event.at,
      tool: event.tool,
      category: context?.category ?? '',
      argsHash: event.argsHash,
      safeArgs: context?.safeArgs ?? {},
      decision: event.decision,
      ok: event.ok,
      durationMs: event.durationMs
    })
  }

  const route = (call: GeminiFunctionCall): Promise<ToolCallResult> =>
    routeToolCall(
      {
        registry,
        getHandler: (name) => handlers.get(name) ?? null,
        getPermission,
        confirm,
        audit
      },
      call
    )

  const routineConfirm = async (
    routine: { action: { tool: string; args?: Record<string, unknown> } },
    action: { tool: string; args?: Record<string, unknown> }
  ): Promise<boolean> => {
    const tool = registry.getTool(action.tool)
    if (!tool) return false
    return confirm({ tool, args: action.args ?? {} })
  }

  const scheduler = createRoutineScheduler({
    getRoutines: () => getStoreSnapshot().routines,
    execute: async (action) => {
      const result = await route({ name: action.tool, args: action.args ?? {} })
      if (!result.ok) return { ok: false, error: result.error.message }
      return { ok: true }
    },
    isSensitive: (toolName) => registry.getTool(toolName)?.sensitive === true,
    confirm: routineConfirm,
    audit: (event: RoutineAuditEvent) => {
      auditWriter.write({
        at: event.at,
        tool: event.tool,
        category: 'routine',
        argsHash: hashActionArgs(event),
        safeArgs: sanitizeSafeArgs({ id: event.routineId }),
        decision: event.decision,
        ok: event.ok,
        durationMs: event.durationMs
      })
    }
  })
  scheduler.start()

  const togglePause = (): void => {
    const current = getStoreSnapshot().permissions.paused
    const next = !current
    const result = setPaused(permissionStore, next)
    if (!result.ok) {
      logger.warn('actions', `falha ao alternar a pausa: ${result.error ?? 'desconhecida'}`)
      return
    }
    notifier(next ? 'Ações pausadas.' : 'Ações reativadas.')
  }
  registerPauseShortcut(togglePause)

  registerShutdownHook('actions', () => {
    scheduler.stop()
    unregisterPauseShortcut()
  })

  return {
    registry,
    handlers,
    scheduler,
    route,
    setNotifier: (next) => {
      notifier = next
    }
  }
}

export function ensureActionsRuntime(ctx: IpcContext): ActionsRuntime {
  if (!runtime) runtime = createActionsRuntime(ctx)
  return runtime
}

export function getActionsRuntime(): ActionsRuntime | null {
  return runtime
}

export function setActionsRuntimeForTests(next: ActionsRuntime | null): void {
  runtime = next
}
