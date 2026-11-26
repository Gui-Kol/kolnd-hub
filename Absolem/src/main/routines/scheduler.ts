import type { Routine, RoutineAction } from '../../shared/routines'

/**
 * Scheduler de rotinas (task 08, T8).
 *
 * - um tick por minuto, só com o app aberto (sem Agendador de Tarefas);
 * - tolerância de 1 h para o horário perdido com o app fechado;
 * - rotina que chama ferramenta sensível pede confirmação NA HORA (o
 *   consentimento de uma execução anterior não é herdado);
 * - auditoria própria com `tool: 'routine:<id>'`.
 *
 * O executor, o relógio, a confirmação e a auditoria são injetados: o teste não
 * executa ferramenta nenhuma.
 */

export const ROUTINE_TICK_MS = 60_000
export const ROUTINE_TOLERANCE_MS = 60 * 60 * 1000

export type RoutineDecision = 'allow' | 'ask-accepted' | 'ask-denied' | 'skipped' | 'failed'

export interface RoutineAuditEvent {
  at: string
  tool: string
  routineId: string
  decision: RoutineDecision
  ok: boolean
  durationMs: number
  error?: string
}

export interface RoutineExecution {
  ok: boolean
  error?: string
}

export interface SchedulerDeps {
  getRoutines: () => Routine[]
  execute: (action: RoutineAction, routine: Routine) => Promise<RoutineExecution>
  isSensitive: (tool: string) => boolean
  confirm: (routine: Routine, action: RoutineAction) => Promise<boolean>
  audit: (event: RoutineAuditEvent) => void
  now?: () => Date
  intervalMs?: number
  toleranceMs?: number
}

export interface RoutineTickResult {
  id: string
  status: 'ran' | 'denied' | 'skipped' | 'failed'
  ok: boolean
  error?: string
}

export interface RoutineScheduler {
  tick: (at?: Date) => Promise<RoutineTickResult[]>
  start: () => void
  stop: () => void
  isRunning: () => boolean
}

interface PickedSlot {
  slot: Date
  late: boolean
}

function slotOn(date: Date, time: string): Date {
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0)
}

function matchesWeekday(routine: Routine, slot: Date): boolean {
  if (routine.when.type === 'daily') return true
  return slot.getDay() === routine.when.weekday
}

/**
 * Escolhe a ocorrência mais recente que já passou:
 * - hoje, se o horário de hoje já passou;
 * - caso contrário, a de ontem (cobre a tolerância atravessando a meia-noite).
 * Um horário de hoje no futuro não gera "skip": a rotina ainda vai rodar.
 */
export function pickRoutineSlot(
  routine: Routine,
  now: Date,
  toleranceMs: number
): PickedSlot | null {
  const today = slotOn(now, routine.when.time)
  if (today.getTime() <= now.getTime() && matchesWeekday(routine, today)) {
    return { slot: today, late: now.getTime() - today.getTime() > toleranceMs }
  }
  const yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const yesterday = slotOn(yesterdayDate, routine.when.time)
  if (
    yesterday.getTime() <= now.getTime() &&
    matchesWeekday(routine, yesterday) &&
    now.getTime() - yesterday.getTime() <= toleranceMs
  ) {
    return { slot: yesterday, late: false }
  }
  return null
}

function slotKey(routine: Routine, slot: Date): string {
  const date = `${slot.getFullYear()}-${String(slot.getMonth() + 1).padStart(2, '0')}-${String(
    slot.getDate()
  ).padStart(2, '0')}`
  return `${routine.id}:${date}:${routine.when.time}`
}

export function createRoutineScheduler(deps: SchedulerDeps): RoutineScheduler {
  const now = deps.now ?? (() => new Date())
  const toleranceMs = deps.toleranceMs ?? ROUTINE_TOLERANCE_MS
  const intervalMs = deps.intervalMs ?? ROUTINE_TICK_MS
  const executedSlots = new Set<string>()
  let timer: ReturnType<typeof setInterval> | null = null

  const emit = (event: RoutineAuditEvent): void => {
    try {
      deps.audit(event)
    } catch {
      // Auditoria best-effort; a rotina segue.
    }
  }

  async function tick(at?: Date): Promise<RoutineTickResult[]> {
    const instant = at ?? now()
    const results: RoutineTickResult[] = []
    for (const routine of deps.getRoutines()) {
      if (!routine.enabled) continue
      const picked = pickRoutineSlot(routine, instant, toleranceMs)
      if (!picked) continue
      const key = slotKey(routine, picked.slot)
      if (executedSlots.has(key)) continue
      executedSlots.add(key)
      const startedAt = instant.getTime()
      const auditBase = {
        at: instant.toISOString(),
        tool: `routine:${routine.id}`,
        routineId: routine.id,
        durationMs: 0
      }

      if (picked.late) {
        emit({ ...auditBase, decision: 'skipped', ok: false, error: 'horário perdido (> 1 h)' })
        results.push({ id: routine.id, status: 'skipped', ok: false })
        continue
      }

      const sensitive = deps.isSensitive(routine.action.tool)
      let decision: RoutineDecision = 'allow'
      if (sensitive) {
        let accepted: boolean
        try {
          accepted = (await deps.confirm(routine, routine.action)) === true
        } catch {
          accepted = false
        }
        if (!accepted) {
          emit({ ...auditBase, decision: 'ask-denied', ok: false })
          results.push({ id: routine.id, status: 'denied', ok: false })
          continue
        }
        decision = 'ask-accepted'
      }

      try {
        const execution = await deps.execute(routine.action, routine)
        emit({
          ...auditBase,
          decision: execution.ok ? decision : 'failed',
          ok: execution.ok,
          durationMs: Math.max(0, now().getTime() - startedAt),
          ...(execution.error ? { error: execution.error } : {})
        })
        results.push({
          id: routine.id,
          status: execution.ok ? 'ran' : 'failed',
          ok: execution.ok,
          ...(execution.error ? { error: execution.error } : {})
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        emit({
          ...auditBase,
          decision: 'failed',
          ok: false,
          durationMs: Math.max(0, now().getTime() - startedAt),
          error: message
        })
        results.push({ id: routine.id, status: 'failed', ok: false, error: message })
      }
    }
    return results
  }

  return {
    tick,
    start: () => {
      if (timer) return
      timer = setInterval(() => {
        void tick()
      }, intervalMs)
    },
    stop: () => {
      if (!timer) return
      clearInterval(timer)
      timer = null
    },
    isRunning: () => timer !== null
  }
}
