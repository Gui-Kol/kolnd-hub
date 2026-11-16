import { ipcMain } from 'electron'
import { spawn, execFileSync } from 'child_process'
import { existsSync, rmSync, statSync } from 'fs'
import { basename, dirname, extname, isAbsolute, join } from 'path'
import { getStoredGames, setStoredGames, normalizeGame, GameOrigin } from './store'
import {
  formatGameName,
  exePathHash,
  isValidId,
  isValidExePath,
  EXE_PATH_MAX_LENGTH,
  GameResult
} from './games/naming'
import { listRunningProcesses } from './startupManager'
import treeKill from 'tree-kill'
import { logger } from './logger'
import {
  gameIconsDir,
  resolveIconInsideGameIcons,
  deleteStaleIcons,
  extractIconPng,
  deleteCachedIcon,
  pickGameIcon,
  setGameIcon,
  previewExeIcon,
  restoreExeIcon,
  getGameIcon
} from './games/icons'
import type { PickIconResult, IconPathResult, PreviewExeIconResult } from './games/icons'

/**
 * Biblioteca de jogos do Kolnd Hub.
 *
 * Persistência canônica no electron-store (chave `games`, ver store.ts) —
 * nunca localStorage nem JSON solto. Os ícones extraídos ficam em
 * `%APPDATA%/kolnd-hub/game-icons/` e o `iconPath` gravado no jogo é sempre
 * um caminho absoluto dentro dessa pasta (defesa contra leitura arbitrária
 * de arquivos via IPC comprometido).
 *
 * IMPORTANTE: `games:launch` faz spawn direto do exe (ou, se o jogo já
 * estiver aberto, traz a janela dele para o primeiro plano em vez de abrir
 * outra instância). Não reutiliza o ProcessManager (`app:launch`) de
 * propósito — jogos não contam como "apps gerenciados em execução" e não
 * devem inflacionar o contador do Layout.
 */

export interface Game {
  id: string
  name: string
  exePath: string
  iconPath: string | null
  origin: GameOrigin
  steamAppId?: number
  addedAt: string
}

/** Re-exporta o que saiu para games/naming.ts e games/icons.ts, mantendo a superfície pública de './games'. */
export { formatGameName } from './games/naming'
export type { GameResult } from './games/naming'
export {
  gameIconsDir,
  extractIconPng,
  pickGameIcon,
  setGameIcon,
  previewExeIcon,
  restoreExeIcon,
  getGameIcon
} from './games/icons'
export type { PickIconResult, IconPathResult, PreviewExeIconResult } from './games/icons'

/** Resultado de `games:add-custom` — inclui o nome formatado para o toast de confirmação. */
export interface AddCustomGameResult extends GameResult {
  id?: string
  name?: string
}

export function getGames(): Game[] {
  return getStoredGames()
}

export function addGame(input: unknown): GameResult {
  const game = normalizeGame(input)
  if (!game) {
    return {
      success: false,
      error: 'Dados do jogo inválidos (id, nome e executável são obrigatórios).'
    }
  }
  if (game.iconPath) {
    // Ícone fora da pasta canônica seria uma leitura arbitrária via get-icon.
    const resolved = resolveIconInsideGameIcons(game.iconPath)
    if (!resolved) {
      return { success: false, error: 'O ícone deve estar dentro da pasta de ícones do Kolnd Hub.' }
    }
    game.iconPath = resolved
  }

  const games = getStoredGames()
  if (games.some((g) => g.id === game.id)) {
    return { success: false, error: 'Já existe um jogo com este identificador.' }
  }
  if (game.steamAppId !== undefined && games.some((g) => g.steamAppId === game.steamAppId)) {
    return { success: false, error: 'Este jogo da Steam já está na sua biblioteca.' }
  }
  const exeKey = game.exePath.toLowerCase()
  if (games.some((g) => g.exePath.toLowerCase() === exeKey)) {
    return { success: false, error: 'Este executável já está na sua biblioteca.' }
  }

  const saved = setStoredGames([...games, game])
  if (!saved.success) {
    return { success: false, error: saved.error ?? 'Não foi possível salvar o jogo.' }
  }
  logger.info('games', `Jogo adicionado: ${game.name} (${game.id})`)
  return { success: true }
}

/**
 * Adiciona um jogo personalizado a partir do caminho absoluto de um .exe
 * escolhido pelo usuário (seletor nativo via `dialog:pick-path`).
 * O exe NÃO é copiado — o caminho gravado é o original. O ícone embutido é
 * extraído para `game-icons/custom_<hash>.png` (hash do caminho, igual ao
 * `id` `custom-<hash>`, tornando o fluxo idempotente).
 */
export async function addCustomGame(exePathInput: unknown): Promise<AddCustomGameResult> {
  if (!isValidExePath(exePathInput)) {
    return { success: false, error: 'Caminho do executável inválido.' }
  }
  const exePath = (exePathInput as string).trim()
  if (!isAbsolute(exePath)) {
    return { success: false, error: 'Escolha um caminho absoluto para o executável.' }
  }
  if (extname(exePath).toLowerCase() !== '.exe') {
    return { success: false, error: 'Escolha um arquivo .exe do jogo.' }
  }
  try {
    const stat = statSync(exePath)
    if (!stat.isFile()) {
      return { success: false, error: 'O caminho escolhido não é um arquivo.' }
    }
  } catch {
    return { success: false, error: `Executável não encontrado: ${exePath}` }
  }

  const hash = exePathHash(exePath)
  const id = `custom-${hash}`
  const name = formatGameName(basename(exePath, extname(exePath)))

  // Já está na biblioteca? Falha com mensagem clara em vez de um erro de id.
  const existing = getStoredGames()
  const exeKey = exePath.toLowerCase()
  if (existing.some((g) => g.id === id || g.exePath.toLowerCase() === exeKey)) {
    return { success: false, error: 'Este jogo já está na sua biblioteca.' }
  }

  const iconPath = join(gameIconsDir(), `custom_${hash}.png`)
  const iconOk = await extractIconPng(exePath, iconPath)

  const result = addGame({
    id,
    name,
    exePath,
    iconPath: iconOk ? iconPath : null,
    origin: 'custom',
    addedAt: new Date().toISOString()
  })
  if (!result.success) {
    return { success: false, error: result.error ?? 'Não foi possível adicionar o jogo.' }
  }
  logger.info('games', `Jogo personalizado adicionado: ${name} (${exePath})`)
  return { success: true, id, name }
}

/** Verifica, em lote, quais executáveis existem no disco (selo ".exe não encontrado"). */
export function checkExePaths(pathsInput: unknown): boolean[] {
  if (!Array.isArray(pathsInput)) return []
  return pathsInput.slice(0, 500).map((entry) => {
    if (typeof entry !== 'string') return false
    const trimmed = entry.trim()
    if (!trimmed || trimmed.length > EXE_PATH_MAX_LENGTH) return false
    try {
      return existsSync(trimmed)
    } catch {
      return false
    }
  })
}

/** Campos do patch que o renderer pode alterar (whitelist). */
const PATCHABLE_FIELDS = ['name', 'exePath', 'iconPath', 'origin', 'steamAppId'] as const

export function updateGame(id: unknown, patch: unknown): GameResult {
  if (!isValidId(id)) {
    return { success: false, error: 'Identificador do jogo inválido.' }
  }
  const trimmedId = id.trim()
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { success: false, error: 'Alterações inválidas.' }
  }

  const games = getStoredGames()
  const index = games.findIndex((g) => g.id === trimmedId)
  if (index === -1) {
    return { success: false, error: 'Jogo não encontrado na biblioteca.' }
  }

  const current = games[index]
  const raw = patch as Record<string, unknown>
  const merged: Record<string, unknown> = { ...current }

  for (const field of PATCHABLE_FIELDS) {
    if (!(field in raw)) continue
    const value = raw[field]
    switch (field) {
      case 'name':
        if (typeof value !== 'string' || !value.trim()) {
          return { success: false, error: 'O nome do jogo não pode ficar vazio.' }
        }
        merged.name = value.trim()
        break
      case 'exePath':
        if (!isValidExePath(value)) {
          return { success: false, error: 'Caminho do executável inválido.' }
        }
        merged.exePath = (value as string).trim()
        break
      case 'iconPath':
        // null limpa o ícone (o card cai no fallback visual).
        if (value === null) {
          merged.iconPath = null
          break
        }
        {
          const resolved = resolveIconInsideGameIcons(value)
          if (!resolved) {
            return {
              success: false,
              error: 'O ícone deve estar dentro da pasta de ícones do Kolnd Hub.'
            }
          }
          merged.iconPath = resolved
        }
        break
      case 'origin':
        if (value !== 'steam' && value !== 'custom') {
          return { success: false, error: 'Origem do jogo inválida.' }
        }
        merged.origin = value
        break
      case 'steamAppId':
        if (value === null) {
          delete merged.steamAppId
          break
        }
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
          return { success: false, error: 'steamAppId inválido.' }
        }
        merged.steamAppId = value
        break
    }
  }

  const updated = normalizeGame(merged)
  if (!updated) {
    return { success: false, error: 'Dados do jogo inválidos após a alteração.' }
  }

  games[index] = updated
  const saved = setStoredGames(games)
  if (!saved.success) {
    return { success: false, error: saved.error ?? 'Não foi possível salvar as alterações.' }
  }

  // Ícone trocado/limpo: depois de persistir com sucesso, apaga o arquivo
  // antigo (se estava na pasta de ícones e não é mais o referenciado) e
  // quaisquer sobras `<base-do-id>.<ext>` da imagem anterior.
  if ('iconPath' in raw) {
    const resolvedNew = resolveIconInsideGameIcons(updated.iconPath)
    const resolvedOld = resolveIconInsideGameIcons(current.iconPath)
    if (resolvedOld && resolvedOld !== resolvedNew) {
      try {
        rmSync(resolvedOld, { force: true })
      } catch (err) {
        logger.warn('games', `Não foi possível apagar o ícone antigo ${resolvedOld}:`, err)
      }
    }
    deleteStaleIcons(updated.id, resolvedNew)
  }
  logger.info('games', `Jogo atualizado: ${updated.name} (${updated.id})`)
  return { success: true }
}

export function removeGame(id: unknown): GameResult {
  if (!isValidId(id)) {
    return { success: false, error: 'Identificador do jogo inválido.' }
  }
  const trimmedId = id.trim()
  const games = getStoredGames()
  const index = games.findIndex((g) => g.id === trimmedId)
  if (index === -1) {
    return { success: false, error: 'Jogo não encontrado na biblioteca.' }
  }

  const [removed] = games.splice(index, 1)
  const saved = setStoredGames(games)
  if (!saved.success) {
    return { success: false, error: saved.error ?? 'Não foi possível remover o jogo.' }
  }

  // Só apaga o ícone cacheado DEPOIS de persistir a remoção.
  deleteCachedIcon(removed)
  logger.info('games', `Jogo removido: ${removed.name} (${removed.id})`)
  return { success: true }
}

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

/** Registra os canais IPC da biblioteca de jogos. */
export function registerGamesIpc(): void {
  ipcMain.handle('games:get', (): Game[] => getGames())

  ipcMain.handle('games:add', (_event, input: unknown): GameResult => addGame(input))

  ipcMain.handle('games:add-custom', (_event, exePath: unknown): Promise<AddCustomGameResult> =>
    addCustomGame(exePath)
  )

  ipcMain.handle('games:update', (_event, id: unknown, patch: unknown): GameResult =>
    updateGame(id, patch)
  )

  ipcMain.handle('games:pick-icon', (): Promise<PickIconResult> => pickGameIcon())

  ipcMain.handle('games:set-icon', (_event, id: unknown, dataUrl: unknown): IconPathResult =>
    setGameIcon(id, dataUrl)
  )

  ipcMain.handle(
    'games:preview-exe-icon',
    (_event, exePath: unknown): Promise<PreviewExeIconResult> => previewExeIcon(exePath)
  )

  ipcMain.handle(
    'games:restore-exe-icon',
    (_event, id: unknown, exePath?: unknown): Promise<IconPathResult> => restoreExeIcon(id, exePath)
  )

  ipcMain.handle('games:check-exes', (_event, paths: unknown): boolean[] => checkExePaths(paths))

  ipcMain.handle('games:remove', (_event, id: unknown): GameResult => removeGame(id))

  ipcMain.handle('games:launch', (_event, id: unknown): Promise<LaunchGameResult> => launchGame(id))

  ipcMain.handle(
    'games:stop',
    (_event, id: unknown): Promise<{ ok: boolean; error?: string; killed?: number }> => stopGame(id)
  )

  ipcMain.handle('games:running-map', (_event, ids: unknown) => runningGamesMap(ids))

  ipcMain.handle('games:get-icon', (_event, id: unknown): string | null => getGameIcon(id))
}
