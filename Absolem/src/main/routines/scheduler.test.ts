import { describe, expect, it, vi } from 'vitest'
import { normalizeRoutines, type Routine } from '../../shared/routines'
import { createRoutineScheduler, type RoutineAuditEvent, type SchedulerDeps } from './scheduler'

/**
 * Rotinas (T8) sem timer real e sem executar ferramenta: `execute`, `confirm`,
 * `audit` e `now` são fakes; `tick` recebe o instante explicitamente.
 */

function routine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: 'rotina-1',
    name: 'Rotina de teste',
    when: { type: 'daily', time: '10:00' },
    action: { tool: 'open_app', args: { name: 'Notepad' } },
    enabled: true,
    ...overrides
  }
}

function harness(options: {
  routines: Routine[]
  sensitive?: boolean
  confirm?: () => Promise<boolean>
  execute?: SchedulerDeps['execute']
}) {
  const execute = vi.fn(options.execute ?? (async () => ({ ok: true })))
  const confirm = vi.fn(options.confirm ?? (async () => true))
  const audits: RoutineAuditEvent[] = []
  const deps: SchedulerDeps = {
    getRoutines: () => options.routines,
    execute,
    isSensitive: () => options.sensitive === true,
    confirm,
    audit: (event) => audits.push(event),
    now: () => new Date(2026, 10, 26, 10, 0, 0)
  }
  return { deps, execute, confirm, audits }
}

describe('scheduler de rotinas', () => {
  it('executa no minuto certo uma vez por ocorrência', async () => {
    const { deps, execute, audits } = harness({ routines: [routine()] })
    const scheduler = createRoutineScheduler(deps)
    const at = new Date(2026, 10, 26, 10, 0, 0)

    const first = await scheduler.tick(at)
    expect(first).toEqual([{ id: 'rotina-1', status: 'ran', ok: true }])
    expect(execute).toHaveBeenCalledTimes(1)
    expect(audits[0]).toMatchObject({ tool: 'routine:rotina-1', decision: 'allow', ok: true })

    const second = await scheduler.tick(new Date(2026, 10, 26, 10, 0, 30))
    expect(second).toEqual([])
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('tolerância de 1 h: executa atrasada até 1 h e pula depois', async () => {
    const within = harness({ routines: [routine()] })
    const lateScheduler = createRoutineScheduler(within.deps)
    expect(await lateScheduler.tick(new Date(2026, 10, 26, 10, 59, 0))).toEqual([
      { id: 'rotina-1', status: 'ran', ok: true }
    ])

    const beyond = harness({ routines: [routine()] })
    const skippedScheduler = createRoutineScheduler(beyond.deps)
    expect(await skippedScheduler.tick(new Date(2026, 10, 26, 11, 1, 0))).toEqual([
      { id: 'rotina-1', status: 'skipped', ok: false }
    ])
    expect(beyond.execute).not.toHaveBeenCalled()
    expect(beyond.audits[0]).toMatchObject({ decision: 'skipped', tool: 'routine:rotina-1' })
  })

  it('rotina sensível pede confirmação na execução e não herda consentimento', async () => {
    const denied = harness({ routines: [routine()], sensitive: true, confirm: async () => false })
    const deniedScheduler = createRoutineScheduler(denied.deps)
    expect(await deniedScheduler.tick(new Date(2026, 10, 26, 10, 0, 0))).toEqual([
      { id: 'rotina-1', status: 'denied', ok: false }
    ])
    expect(denied.confirm).toHaveBeenCalledTimes(1)
    expect(denied.execute).not.toHaveBeenCalled()
    expect(denied.audits[0]).toMatchObject({ decision: 'ask-denied', ok: false })

    const accepted = harness({ routines: [routine()], sensitive: true, confirm: async () => true })
    const acceptedScheduler = createRoutineScheduler(accepted.deps)
    expect(await acceptedScheduler.tick(new Date(2026, 10, 26, 10, 0, 0))).toEqual([
      { id: 'rotina-1', status: 'ran', ok: true }
    ])
    expect(accepted.audits[0]).toMatchObject({ decision: 'ask-accepted', ok: true })
  })

  it('rotina desabilitada não executa', async () => {
    const { deps, execute } = harness({ routines: [routine({ enabled: false })] })
    const scheduler = createRoutineScheduler(deps)

    expect(await scheduler.tick(new Date(2026, 10, 26, 10, 0, 0))).toEqual([])
    expect(execute).not.toHaveBeenCalled()
  })

  it('limite de 20 rotinas é aplicado na normalização', () => {
    const many = Array.from({ length: 25 }, (_unused, index) =>
      routine({ id: `rotina-${index}`, name: `Rotina ${index}` })
    )

    const normalized = normalizeRoutines(many)

    expect(normalized).toHaveLength(20)
    expect(normalized[19]?.id).toBe('rotina-19')
  })
})
