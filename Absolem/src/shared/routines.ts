/**
 * Rotinas agendadas simples (task 08, T8).
 *
 * Rotinas rodam SÓ com o app aberto (sem Agendador de Tarefas). O formato é
 * dado puro: validação/normalização no shared, execução no scheduler do main.
 */

export const MAX_ROUTINES = 20
export const MAX_ROUTINE_NAME = 80
export const MAX_ROUTINE_ID = 64

export const ROUTINE_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const

export type RoutineWeekday = (typeof ROUTINE_WEEKDAYS)[number]

export interface RoutineWhen {
  type: 'daily' | 'weekly'
  /** Horário local no formato HH:MM. */
  time: string
  /** 0 = domingo ... 6 = sábado; exigido em `weekly`. */
  weekday?: RoutineWeekday
}

export interface RoutineAction {
  tool: string
  args?: Record<string, unknown>
}

export interface Routine {
  id: string
  name: string
  when: RoutineWhen
  action: RoutineAction
  enabled: boolean
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const TOOL_RE = /^[a-z][a-z0-9_]{1,63}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isValidRoutineTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value)
}

/** `null` para rotina inválida: o store descarta em vez de guardar lixo. */
export function normalizeRoutine(input: unknown): Routine | null {
  if (!isRecord(input)) return null
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!ID_RE.test(id) || !name || name.length > MAX_ROUTINE_NAME) return null

  const when = input.when
  if (!isRecord(when)) return null
  const type = when.type
  if (type !== 'daily' && type !== 'weekly') return null
  if (!isValidRoutineTime(when.time)) return null
  const normalizedWhen: RoutineWhen = { type, time: when.time }
  if (type === 'weekly') {
    const weekday = when.weekday
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return null
    }
    normalizedWhen.weekday = weekday as RoutineWeekday
  }

  const action = input.action
  if (!isRecord(action) || typeof action.tool !== 'string' || !TOOL_RE.test(action.tool)) {
    return null
  }
  if (action.args !== undefined && !isRecord(action.args)) return null

  return {
    id,
    name,
    when: normalizedWhen,
    action: {
      tool: action.tool,
      ...(isRecord(action.args) ? { args: action.args } : {})
    },
    enabled: input.enabled === true
  }
}

/** Lista normalizada, ids únicos e limite de 20; entradas inválidas somem. */
export function normalizeRoutines(input: unknown): Routine[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const routines: Routine[] = []
  for (const candidate of input) {
    const routine = normalizeRoutine(candidate)
    if (!routine || seen.has(routine.id)) continue
    seen.add(routine.id)
    routines.push(routine)
    if (routines.length >= MAX_ROUTINES) break
  }
  return routines
}
