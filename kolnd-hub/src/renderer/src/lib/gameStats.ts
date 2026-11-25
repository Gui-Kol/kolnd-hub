// Estatísticas de jogo da Biblioteca (T2/T5) — puro, sem Electron/DOM.
// `playtimeDays` guarda segundos por dia LOCAL (`YYYY-MM-DD`); "semana" começa
// segunda-feira 00:00 local, como decidido na spec da Biblioteca.

import type { Game } from '../types'

/** Chave `YYYY-MM-DD` de uma data local. */
function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Segunda-feira 00:00 local da semana de `now`. */
function startOfLocalWeek(now: Date): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysSinceMonday = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - daysSinceMonday)
  return start
}

function plural(value: number, singular: string, pluralForm: string): string {
  return `${value} ${value === 1 ? singular : pluralForm}`
}

/**
 * Tempo legível: "menos de 1 min", "42 min", "3 h", "3 h 20 min".
 * Ausente/zero → "Sem tempo" (a UI decide se mostra a linha).
 */
export function formatPlaytime(totalSeconds?: number | null): string {
  const total = typeof totalSeconds === 'number' && Number.isFinite(totalSeconds) ? totalSeconds : 0
  if (total <= 0) return 'Sem tempo'
  if (total < 60) return 'menos de 1 min'
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/**
 * Total da semana corrente (segunda 00:00 local até hoje). Ignora chaves
 * inválidas e dias futuros; valores não finitos/negativos não somam.
 */
export function weekPlaytimeSeconds(
  days?: Record<string, number> | null,
  now: Date = new Date()
): number {
  if (!days || typeof days !== 'object') return 0
  const startKey = localDateKey(startOfLocalWeek(now))
  const todayKey = localDateKey(now)
  let total = 0
  for (const [key, seconds] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue
    if (key < startKey || key > todayKey) continue
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) continue
    total += seconds
  }
  return total
}

/**
 * "Última vez" em tempo relativo: "agora", "há 5 min", "há 2 h",
 * "há 3 dias", "há 2 semanas", "há 3 meses", "há 2 anos".
 * ISO inválido/ausente → '' (a UI omite o trecho).
 */
export function formatLastPlayed(iso?: string | null, now: Date = new Date()): string {
  if (typeof iso !== 'string' || !iso.trim()) return ''
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const diffSeconds = Math.max(0, Math.floor((now.getTime() - at) / 1000))
  if (diffSeconds < 60) return 'agora'
  const minutes = Math.floor(diffSeconds / 60)
  if (minutes < 60) return `há ${plural(minutes, 'min', 'min')}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${plural(hours, 'h', 'h')}`
  const days = Math.floor(hours / 24)
  if (days < 7) return `há ${plural(days, 'dia', 'dias')}`
  if (days < 30) return `há ${plural(Math.floor(days / 7), 'semana', 'semanas')}`
  if (days < 365) return `há ${plural(Math.floor(days / 30), 'mês', 'meses')}`
  return `há ${plural(Math.floor(days / 365), 'ano', 'anos')}`
}

/**
 * Jogos para "Continuar jogando": só quem tem `lastPlayedAt` válido, do mais
 * recente para o mais antigo, limitado a `limit` (6 na faixa do Dashboard).
 */
export function recentGames(games: readonly Game[], limit = 6): Game[] {
  const max = Number.isInteger(limit) && limit > 0 ? limit : 0
  if (max === 0) return []
  const out: Array<{ game: Game; at: number }> = []
  for (const game of games) {
    if (!game.lastPlayedAt) continue
    const at = Date.parse(game.lastPlayedAt)
    if (Number.isNaN(at)) continue
    out.push({ game, at })
  }
  out.sort((a, b) => {
    if (b.at !== a.at) return b.at - a.at
    return a.game.name.localeCompare(b.game.name, 'pt-BR', { sensitivity: 'base' })
  })
  return out.slice(0, max).map((entry) => entry.game)
}
