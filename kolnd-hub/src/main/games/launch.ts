import { spawn, execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { basename, dirname, extname } from 'path'
import treeKill from 'tree-kill'
import { getStoredGames } from '../store'
import { isValidId } from './naming'
import { listRunningProcesses } from '../startupManager'
import { logger } from '../logger'

/**
 * Descoberta, lançamento e parada de processos de jogos.
 * Extraído de main/games.ts — nenhuma mudança de comportamento.
 */

/**
 * Resultado de `games:launch`.
 * - `focused: true` → jogo já estava aberto e a janela foi trazida para o
 *   primeiro plano (nenhuma segunda instância é criada);
 * - `alreadyRunning: true` → processo encontrado, mas sem janela focável
 *   (ex.: launcher ainda iniciando) — também sem segunda instância.
 */
export interface LaunchGameResult {
  ok: boolean
  error?: string
  focused?: boolean
  alreadyRunning?: boolean
}

/* ══════════ Jogo em execução: detecção, foco e encerramento ══════════ */

/** Nome-base do executável (sem extensão, minúsculo) — chave de casamento com processos. */
function gameExeBaseName(exePath: string): string {
  return basename(exePath, extname(exePath)).trim().toLowerCase()
}

/** BaseName de um caminho sem extensão, minúsculo ('' quando vazio/inválido). */
function pathBaseName(value: string): string {
  const base = (value ?? '').split(/[\\/]/).pop() ?? ''
  return base
    .replace(/\.(exe|cmd|bat|ps1|com)$/i, '')
    .trim()
    .toLowerCase()
}

export interface GameProcess {
  name: string
  id: number
  path: string
}

/**
 * Processos do sistema correspondentes ao executável do jogo (por nome do
 * processo e por baseName do caminho). Usado para detectar "já aberto",
 * focar a janela e encerrar. Em caso de falha na listagem, devolve [].
 */
export function findGameProcesses(exePath: string): GameProcess[] {
  const exeBase = gameExeBaseName(exePath)
  if (!exeBase) return []
  let procs: ReturnType<typeof listRunningProcesses>
  try {
    procs = listRunningProcesses()
  } catch (err) {
    logger.warn('games', 'Não foi possível listar os processos para detectar o jogo:', err)
    return []
  }
  return procs
    .map((p) => ({
      name: String(p?.name ?? ''),
      id: Number(p?.id ?? 0),
      path: String(p?.path ?? '')
    }))
    .filter(
      (p) =>
        p.id > 0 &&
        (p.name.toLowerCase() === exeBase ||
          (pathBaseName(p.path) !== '' && pathBaseName(p.path) === exeBase))
    )
}

// Foca a janela principal de um processo e a restaura se estiver minimizada.
// Usa a dança AttachThreadInput → SetForegroundWindow + SwitchToThisWindow,
// o único caminho confiável para furar o bloqueio de foco do Windows.
const FOCUS_WINDOW_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$pidTarget = [int]$env:KOLND_TARGET_PID',
  '$p = Get-Process -Id $pidTarget',
  'if (-not $p) { exit 2 }',
  '$hwnd = $p.MainWindowHandle',
  'if ($hwnd -eq [IntPtr]::Zero) { exit 3 }',
  "$code = @'",
  'using System;',
  'using System.Runtime.InteropServices;',
  'public class KolndFg {',
  '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
  '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);',
  '  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);',
  '  [DllImport("user32.dll")] public static extern bool SwitchToThisWindow(IntPtr hWnd, bool bAltTabIfMinimized);',
  '  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();',
  '}',
  "'@",
  'Add-Type -TypeDefinition $code',
  '[void][KolndFg]::ShowWindow($hwnd, 9)',
  '$fg = [KolndFg]::GetForegroundWindow()',
  '$fgPid = [uint32]0',
  '$fgThread = [KolndFg]::GetWindowThreadProcessId($fg, [ref]$fgPid)',
  '$cur = [KolndFg]::GetCurrentThreadId()',
  'if ($fgThread -ne $cur -and $fgThread -ne 0) { [void][KolndFg]::AttachThreadInput($cur, $fgThread, $true) }',
  '[void][KolndFg]::SetForegroundWindow($hwnd)',
  '[void][KolndFg]::SwitchToThisWindow($hwnd, $true)',
  'if ($fgThread -ne $cur -and $fgThread -ne 0) { [void][KolndFg]::AttachThreadInput($cur, $fgThread, $false) }',
  'exit 0'
].join('\n')

/** Restaura e traz a janela do processo para o primeiro plano. `true` em sucesso. */
function focusProcessWindow(pid: number): boolean {
  try {
    execFileSync(
      'powershell.exe',
      ['-STA', '-NoProfile', '-NonInteractive', '-Command', FOCUS_WINDOW_SCRIPT],
      {
        windowsHide: true,
        timeout: 5000,
        env: { ...process.env, KOLND_TARGET_PID: String(pid) }
      }
    )
    return true
  } catch (err) {
    logger.warn('games', `Não foi possível focar a janela do processo ${pid}:`, err)
    return false
  }
}

/**
 * Lança o jogo com spawn direto (sem ProcessManager): desanexado, fora do
 * contador de apps ativos do Hub e sem rastreamento de "em execução".
 * Se o jogo JÁ estiver em execução, a janela é trazida para o primeiro
 * plano em vez de iniciar uma segunda instância.
 */
export function launchGame(id: unknown): Promise<LaunchGameResult> {
  if (!isValidId(id)) {
    return Promise.resolve({ ok: false, error: 'Identificador do jogo inválido.' })
  }
  const trimmedId = id.trim()
  const game = getStoredGames().find((g) => g.id === trimmedId)
  if (!game) {
    return Promise.resolve({ ok: false, error: 'Jogo não encontrado na biblioteca.' })
  }
  if (!existsSync(game.exePath)) {
    return Promise.resolve({
      ok: false,
      error: `Executável não encontrado: ${game.exePath}`
    })
  }

  // Já aberto? Foca a janela existente em vez de abrir outra instância.
  const running = findGameProcesses(game.exePath)
  if (running.length > 0) {
    for (const proc of running) {
      if (focusProcessWindow(proc.id)) {
        logger.info('games', `Jogo já em execução — janela focada: ${game.name} (PID ${proc.id})`)
        return Promise.resolve({ ok: true, focused: true })
      }
    }
    // Processo(s) existe(m), mas nenhum tem janela focável ainda (ex.: launcher
    // iniciando o jogo). Não abrir segunda instância — avisar o renderer.
    logger.info('games', `Jogo em execução sem janela focável: ${game.name}`)
    return Promise.resolve({ ok: true, alreadyRunning: true })
  }

  return new Promise((resolvePromise) => {
    let settled = false
    const finish = (result: LaunchGameResult): void => {
      if (settled) return
      settled = true
      resolvePromise(result)
    }

    let child: ReturnType<typeof spawn> | null = null
    try {
      child = spawn(game.exePath, [], {
        cwd: dirname(game.exePath),
        detached: true,
        windowsHide: false,
        stdio: 'ignore',
        shell: false
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      finish({ ok: false, error: `Não foi possível iniciar o jogo: ${message}` })
      return
    }

    child.once('spawn', () => {
      child?.unref()
      logger.info('games', `Jogo iniciado: ${game.name} (${game.exePath})`)
      finish({ ok: true })
    })
    child.once('error', (err: Error) => {
      finish({ ok: false, error: `Não foi possível iniciar o jogo: ${err.message}` })
    })
    // Falha de spawn normalmente dispara 'error' na hora; o timeout é só um
    // guarda para nunca deixar a promise pendente para sempre. Se ele disparar
    // sem 'spawn'/'error', o processo muito provavelmente já foi criado.
    const safety = setTimeout(() => {
      logger.warn(
        'games',
        `Timeout aguardando evento de spawn para ${game.name} — assumindo iniciado.`
      )
      finish({ ok: true })
    }, 5000)
    safety.unref?.()
  })
}

/**
 * Encerra o jogo pelo Hub: localiza os processos cujo executável corresponde
 * ao exe do jogo e mata a árvore de cada um (SIGKILL, como o app:stop faz).
 * Devolve `{ ok: false, error: 'O jogo não está em execução.' }` quando não
 * há processos — o botão do Hub só fica habilitado nesse estado mesmo assim.
 */
export function stopGame(id: unknown): Promise<{ ok: boolean; error?: string; killed?: number }> {
  if (!isValidId(id)) {
    return Promise.resolve({ ok: false, error: 'Identificador do jogo inválido.' })
  }
  const trimmedId = id.trim()
  const game = getStoredGames().find((g) => g.id === trimmedId)
  if (!game) {
    return Promise.resolve({ ok: false, error: 'Jogo não encontrado na biblioteca.' })
  }
  const procs = findGameProcesses(game.exePath)
  if (procs.length === 0) {
    return Promise.resolve({ ok: false, error: 'O jogo não está em execução.' })
  }

  return new Promise((resolveStop) => {
    let remaining = procs.length
    let killed = 0
    let firstError: string | undefined

    for (const proc of procs) {
      treeKill(proc.id, 'SIGKILL', (err?: Error) => {
        if (err) {
          firstError = err.message
        } else {
          killed += 1
        }
        remaining -= 1
        if (remaining === 0) {
          if (killed > 0) {
            logger.info('games', `Jogo encerrado pelo Hub: ${game.name} (${killed} processo(s))`)
            resolveStop({ ok: true, killed })
          } else {
            resolveStop({
              ok: false,
              error: firstError ?? 'Falha ao encerrar o jogo'
            })
          }
        }
      })
    }
  })
}

/**
 * Mapa id → "está aberto" para um lote de ids de jogos. Uma única chamada
 * ao PowerShell (lista de processos) emana o resultado de todos — evite
 * uma chamada por jogo. Ids desconhecidos simplesmente não aparecem no mapa.
 */
export function runningGamesMap(idsInput: unknown): {
  ok: boolean
  running: Record<string, boolean>
} {
  if (!Array.isArray(idsInput)) return { ok: false, running: {} }
  const ids = new Set<string>()
  for (const entry of idsInput.slice(0, 500)) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (trimmed) ids.add(trimmed)
  }
  const running: Record<string, boolean> = {}
  if (ids.size === 0) return { ok: true, running }

  let bases: Set<string>
  try {
    const procs = listRunningProcesses()
    bases = new Set(
      procs
        .flatMap((p) => {
          const byName = String(p?.name ?? '')
            .trim()
            .toLowerCase()
          const byPath = pathBaseName(String(p?.path ?? ''))
          return byPath && byPath !== byName ? [byName, byPath] : [byName]
        })
        .filter(Boolean)
    )
  } catch (err) {
    logger.warn('games', 'running-map: não foi possível listar processos:', err)
    return { ok: false, running: {} }
  }

  for (const game of getStoredGames()) {
    if (!ids.has(game.id)) continue
    running[game.id] = bases.has(gameExeBaseName(game.exePath))
  }
  return { ok: true, running }
}
