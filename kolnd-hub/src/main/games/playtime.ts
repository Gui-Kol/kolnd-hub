import { basename, extname } from 'path'
import type { StoredGame } from '../store'

/**
 * Tempo de jogo da Biblioteca (T2).
 *
 * Conta só as sessões abertas PELO HUB (`launchGame` chama `start` no spawn
 * bem-sucedido). O relógio, a listagem de processos e a persistência são
 * injetados para a lógica ser testável sem Electron/PowerShell.
 *
 * O tick lista os processos UMA vez (mesma lógica de casamento por base name
 * do `launch.ts`) e só acumula enquanto o processo do jogo existe. Cada delta
 * é clampado em 60 s para um sleep/suspensão do PC não inflar o total.
 */

/** Intervalo do tick do tracker. */
export const PLAYTIME_TICK_MS = 20_000
/** Delta máximo contado por tick (evita inflar após sleep). */
export const PLAYTIME_MAX_TICK_SECONDS = 60
/** Flush intermediário (~5 min) para não perder tudo se o app travar. */
export const PLAYTIME_FLUSH_INTERVAL_MS = 5 * 60_000
/** Dias mantidos em `playtimeDays` (mesmo limite de `store.ts`). */
export const PLAYTIME_DAYS_LIMIT = 60

/** Chave `YYYY-MM-DD` da data LOCAL (não UTC). */
export function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Mantém só os `limit` dias mais recentes (chaves ISO ordenam lexicograficamente). */
export function prunePlaytimeDays(
  days: Record<string, number>,
  limit: number = PLAYTIME_DAYS_LIMIT
): Record<string, number> {
  const entries = Object.entries(days)
    .filter(([key, seconds]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && seconds > 0)
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
  const out: Record<string, number> = {}
  for (const [key, seconds] of entries.slice(0, Math.max(0, limit))) out[key] = seconds
  return out
}

/**
 * Aplica `seconds` ao total e ao dia local de `at`. Função pura: devolve um
 * novo jogo (nunca muta o recebido) e mantém no máximo 60 dias.
 * `lastPlayedAt` NÃO é tocado aqui — ele é gravado no launch.
 */
export function applyPlaytime(game: StoredGame, seconds: number, at: Date): StoredGame {
  if (!Number.isFinite(seconds) || seconds <= 0) return game
  const increment = Math.floor(seconds)
  if (increment <= 0) return game

  const key = localDateKey(at)
  const playtimeSeconds = (game.playtimeSeconds ?? 0) + increment
  const playtimeDays = prunePlaytimeDays({
    ...(game.playtimeDays ?? {}),
    [key]: (game.playtimeDays?.[key] ?? 0) + increment
  })
  return { ...game, playtimeSeconds, playtimeDays }
}

/** Processo mínimo aceito pela checagem (mesmo shape de `RunningProcess`). */
export interface PlaytimeProcess {
  name?: unknown
  path?: unknown
  id?: unknown
}

/** Dependências injetáveis do tracker (testes não tocam em Electron/PowerShell). */
export interface PlaytimeTrackerDeps {
  /** Relógio em epoch ms. */
  now: () => number
  /** Listagem única de processos do sistema por tick. */
  listRunningProcesses: () => Promise<PlaytimeProcess[]>
  /** Lista atual de jogos (fonte de verdade). */
  getGames: () => StoredGame[]
  /** Persiste a lista inteira; `false` = falhou (o pendente não é descartado). */
  persistGames: (games: StoredGame[]) => boolean
}

export interface PlaytimeTracker {
  /** Começa a contar a sessão e grava `lastPlayedAt` imediatamente. */
  start: (gameId: string, exePath: string) => void
  /** Uma chamada de listagem por tick; finaliza sessões cujo processo sumiu. */
  tick: () => Promise<void>
  /** Finaliza a sessão agora (persiste o pendente). */
  finish: (gameId: string) => void
  /** Persiste o pendente de todas as sessões (flush periódico / will-quit). */
  flush: () => void
  /** `true` quando uma sessão está sendo contada. */
  isTracking: (gameId: string) => boolean
}

interface Session {
  gameId: string
  exeBase: string
  lastTickAt: number
  pendingSeconds: number
  lastFlushAt: number
}

/** Nome-base do executável (sem extensão, minúsculo) — mesma regra de `launch.ts`. */
function exeBaseName(exePath: string): string {
  return basename(exePath, extname(exePath)).trim().toLowerCase()
}

/** BaseName de um caminho sem extensão de script, minúsculo. */
function pathBaseName(value: string): string {
  const base = value.split(/[\\/]/).pop() ?? ''
  return base
    .replace(/\.(exe|cmd|bat|ps1|com)$/i, '')
    .trim()
    .toLowerCase()
}

/** Conjunto de bases dos processos listados (nome e caminho). */
export function runningBaseNames(processes: PlaytimeProcess[]): Set<string> {
  const bases = new Set<string>()
  for (const process of processes) {
    const name = String(process?.name ?? '')
      .trim()
      .toLowerCase()
    const byPath = pathBaseName(String(process?.path ?? ''))
    if (name) bases.add(name)
    if (byPath && byPath !== name) bases.add(byPath)
  }
  return bases
}

export function createPlaytimeTracker(deps: PlaytimeTrackerDeps): PlaytimeTracker {
  const sessions = new Map<string, Session>()

  /** Persiste o pendente inteiro (segundos) da sessão; devolve `false` em falha. */
  function persistSession(session: Session, nowMs: number): boolean {
    const whole = Math.floor(session.pendingSeconds)
    if (whole <= 0) return true
    const games = deps.getGames()
    const index = games.findIndex((game) => game.id === session.gameId)
    if (index === -1) {
      // Jogo removido da biblioteca: descarta o pendente (não há onde gravar).
      session.pendingSeconds = 0
      return true
    }
    const next = [...games]
    next[index] = applyPlaytime(next[index], whole, new Date(nowMs))
    if (!deps.persistGames(next)) return false
    session.pendingSeconds -= whole
    return true
  }

  return {
    start(gameId: string, exePath: string): void {
      const base = exeBaseName(exePath)
      if (!gameId || !base) return
      const now = deps.now()

      // Sessão anterior do mesmo jogo: salva o pendente antes de reiniciar.
      const previous = sessions.get(gameId)
      if (previous) persistSession(previous, now)

      sessions.set(gameId, {
        gameId,
        exeBase: base,
        lastTickAt: now,
        pendingSeconds: 0,
        lastFlushAt: now
      })

      // `lastPlayedAt` no LAUNCH (não no fim): "Continuar jogando" já o usa
      // durante a sessão. Falha de persistência não impede a contagem.
      const games = deps.getGames()
      const index = games.findIndex((game) => game.id === gameId)
      if (index === -1) return
      const next = [...games]
      next[index] = { ...next[index], lastPlayedAt: new Date(now).toISOString() }
      deps.persistGames(next)
    },

    async tick(): Promise<void> {
      if (sessions.size === 0) return
      let processes: PlaytimeProcess[]
      try {
        processes = await deps.listRunningProcesses()
      } catch {
        // Listagem falhou: mantém as sessões e o pendente para o próximo tick.
        return
      }
      const bases = runningBaseNames(processes)
      const now = deps.now()

      for (const session of [...sessions.values()]) {
        if (!bases.has(session.exeBase)) {
          // Processo sumiu: finaliza e persiste o acumulado.
          persistSession(session, now)
          sessions.delete(session.gameId)
          continue
        }
        const deltaSeconds = Math.max(0, (now - session.lastTickAt) / 1000)
        session.lastTickAt = now
        session.pendingSeconds += Math.min(deltaSeconds, PLAYTIME_MAX_TICK_SECONDS)
        if (now - session.lastFlushAt >= PLAYTIME_FLUSH_INTERVAL_MS) {
          if (persistSession(session, now)) session.lastFlushAt = now
        }
      }
    },

    finish(gameId: string): void {
      const session = sessions.get(gameId)
      if (!session) return
      persistSession(session, deps.now())
      sessions.delete(gameId)
    },

    flush(): void {
      const now = deps.now()
      for (const session of sessions.values()) {
        if (persistSession(session, now)) session.lastFlushAt = now
      }
    },

    isTracking(gameId: string): boolean {
      return sessions.has(gameId)
    }
  }
}
