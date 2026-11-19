import { describe, expect, it } from 'vitest'
import {
  deriveOfficeSnapshot,
  type OfficeActivity,
  type OfficeDepartment,
  type OfficeSessionInput,
  type OfficeSnapshot
} from '../../shared/office'
import { createOfficeAggregator, EMIT_MIN_INTERVAL_MS, PLUGIN_STALE_MS } from './aggregator'

function session(id: string, overrides: Partial<OfficeSessionInput> = {}): OfficeSessionInput {
  return {
    id,
    title: `Sessão ${id}`,
    agent: 'general',
    model: { id: 'deepseek-v4.1-flash', providerID: 'opencode-go' },
    time: { created: 1, busy: 900 },
    location: { directory: 'C:\\repo\\alpha' },
    ...overrides
  }
}

/** Sala automática: sessão fora de departamento não aparece mais no snapshot. */
function roomFor(ids: readonly string[]): OfficeDepartment[] {
  if (ids.length === 0) return []
  return [
    {
      id: 'dep_0000a001',
      name: 'Sala de teste',
      agentID: 'general',
      sessionIDs: [...ids],
      createdAt: 1
    }
  ]
}

function pollerSnapshot(
  sessions: OfficeSessionInput[],
  now: number,
  activity?: Map<string, OfficeActivity>,
  departments: OfficeDepartment[] = roomFor(sessions.map((item) => item.id))
): OfficeSnapshot {
  return deriveOfficeSnapshot({
    sessions,
    activityBySession: activity,
    now,
    departments,
    source: 'poller',
    health: { cliFound: true, cliPath: 'C:\\tools\\opencode-cli.exe' }
  })
}

function clocked() {
  let value = 1000
  return {
    now: () => value,
    set(next: number) {
      value = next
    },
    advance(ms: number) {
      value += ms
    }
  }
}

describe('createOfficeAggregator', () => {
  it('atividade do plugin vence a do poller', () => {
    const clock = clocked()
    const aggregator = createOfficeAggregator({
      now: clock.now,
      getDepartments: () => roomFor(['ses_1'])
    })
    const activity = new Map<string, OfficeActivity>([
      ['ses_1', { kind: 'shell', label: 'Executando npm test', at: 800 }]
    ])

    expect(aggregator.setPoller(pollerSnapshot([session('ses_1')], 1000, activity))).not.toBeNull()

    clock.set(1300)
    aggregator.applyEvent({
      type: 'tool',
      at: 1290,
      sessionID: 'ses_1',
      tool: { name: 'edit', status: 'running', filePath: 'auth.ts' }
    })

    const snapshot = aggregator.getSnapshot()
    expect(snapshot?.agents[0].activity).toMatchObject({ kind: 'edit', label: 'Editando auth.ts' })
    expect(snapshot?.feed[0].label).toBe('Editando auth.ts')
  })

  it('needsYou vem do pedido de permissão e sai quando a permissão é respondida', () => {
    const clock = clocked()
    const aggregator = createOfficeAggregator({
      now: clock.now,
      getDepartments: () => roomFor(['ses_1'])
    })
    aggregator.setPoller(pollerSnapshot([session('ses_1')], 1000))

    clock.set(1300)
    aggregator.applyEvent({
      type: 'permission',
      at: 1300,
      sessionID: 'ses_1',
      request: { id: 'per_1', action: 'bash', resources: 'rm -rf build' }
    })

    const pending = aggregator.getSnapshot()
    expect(pending?.totals.needsYou).toBe(1)
    expect(pending?.agents[0].status).toBe('needsYou')
    expect(pending?.requests).toEqual([
      {
        id: 'per_1',
        sessionID: 'ses_1',
        action: 'bash',
        resources: ['rm -rf build'],
        save: [],
        at: 1300
      }
    ])

    clock.set(1600)
    aggregator.applyEvent({
      type: 'permission-replied',
      at: 1600,
      sessionID: 'ses_1',
      requestID: 'per_1'
    })

    const resolved = aggregator.getSnapshot()
    expect(resolved?.totals.needsYou).toBe(0)
    expect(resolved?.agents[0].status).toBe('working')
    expect(resolved?.requests).toEqual([])
  })

  it('monta a fila de pedidos do mais recente ao mais antigo, com save e recursos', () => {
    const clock = clocked()
    const aggregator = createOfficeAggregator({
      now: clock.now,
      getDepartments: () => roomFor(['ses_1', 'ses_2'])
    })
    aggregator.setPoller(pollerSnapshot([session('ses_1'), session('ses_2')], 1000))

    clock.set(1300)
    aggregator.applyEvent({
      type: 'permission',
      at: 1300,
      sessionID: 'ses_1',
      request: { id: 'per_1', action: 'shell', resources: 'npm run verify' }
    })
    clock.set(1400)
    aggregator.applyEvent({
      type: 'permission',
      at: 1400,
      sessionID: 'ses_2',
      request: {
        id: 'per_2',
        action: 'edit',
        resources: 'src/auth.ts',
        save: ['src/auth.ts']
      }
    })

    const snapshot = aggregator.getSnapshot()
    expect(snapshot?.requests.map((request) => request.id)).toEqual(['per_2', 'per_1'])
    expect(snapshot?.requests[0]).toMatchObject({
      sessionID: 'ses_2',
      action: 'edit',
      resources: ['src/auth.ts'],
      save: ['src/auth.ts'],
      at: 1400
    })
    expect(snapshot?.totals.needsYou).toBe(2)
  })

  it('lista completa de permissões substitui a anterior e o plugin velho zera a fila', () => {
    const clock = clocked()
    const aggregator = createOfficeAggregator({
      now: clock.now,
      getDepartments: () => roomFor(['ses_1'])
    })
    aggregator.setPoller(pollerSnapshot([session('ses_1')], 1000))

    clock.set(1300)
    aggregator.applyEvent({
      type: 'permission',
      at: 1300,
      sessionID: 'ses_1',
      request: { id: 'per_1', action: 'shell', resources: 'npm test' }
    })
    clock.set(1350)
    aggregator.applyEvent({
      type: 'permissions',
      at: 1350,
      sessionID: 'ses_1',
      requests: [{ id: 'per_2', action: 'shell', resources: 'npm run build' }]
    })

    expect(aggregator.getSnapshot()?.requests.map((request) => request.id)).toEqual(['per_2'])

    // 15 s sem ping: o plugin cai e nem pedido nem needsYou sobrevivem.
    clock.set(1400 + PLUGIN_STALE_MS)
    const stale = aggregator.getSnapshot()
    expect(stale?.health.pluginConnected).toBe(false)
    expect(stale?.requests).toEqual([])
    expect(stale?.totals.needsYou).toBe(0)
  })

  it('sessão conhecida só pelo plugin aparece quando está na sala', () => {
    const clock = clocked()
    const aggregator = createOfficeAggregator({
      now: clock.now,
      getDepartments: () => roomFor(['ses_so_plugin'])
    })

    aggregator.applyEvent({
      type: 'sessions',
      at: 1000,
      sessions: [
        {
          id: 'ses_so_plugin',
          title: 'Sessão do plugin',
          agent: 'general',
          model: { id: 'm1', providerID: 'p1' },
          time: { created: 100, busy: 990 },
          location: { directory: 'C:\\repo\\beta' }
        }
      ]
    })

    const snapshot = aggregator.getSnapshot()
    expect(snapshot?.source).toBe('plugin')
    expect(snapshot?.health.pluginConnected).toBe(true)
    expect(snapshot?.rooms).toEqual([
      {
        id: 'dep_0000a001',
        name: 'Sala de teste',
        agent: 'general',
        path: 'C:\\repo\\beta',
        agentIDs: ['ses_so_plugin']
      }
    ])
    expect(snapshot?.agents[0]).toMatchObject({ sessionID: 'ses_so_plugin', status: 'working' })
    expect(snapshot?.unassignedCount).toBe(0)
  })

  it('sessão do plugin fora de qualquer sala fica só no contador', () => {
    const clock = clocked()
    const aggregator = createOfficeAggregator({ now: clock.now })
    aggregator.applyEvent({
      type: 'sessions',
      at: 1000,
      sessions: [
        {
          id: 'ses_so_plugin',
          title: 'Sessão do plugin',
          agent: 'general',
          time: { created: 100, busy: 990 },
          location: { directory: 'C:\\repo\\beta' }
        }
      ]
    })

    const snapshot = aggregator.getSnapshot()
    expect(snapshot?.agents).toEqual([])
    expect(snapshot?.rooms).toEqual([])
    expect(snapshot?.unassignedCount).toBe(1)
  })

  it('nome da sala vem do departamento persistido', () => {
    const clock = clocked()
    const aggregator = createOfficeAggregator({
      now: clock.now,
      getDepartments: () => [
        {
          id: 'dep_1a2b3c4d',
          name: 'Kolnd Hub',
          agentID: 'general',
          sessionIDs: ['ses_1'],
          createdAt: 1
        }
      ]
    })
    aggregator.setPoller(
      pollerSnapshot([session('ses_1', { location: { directory: 'C:\\Repo\\Kolnd Hub' } })], 1000)
    )
    aggregator.applyEvent({ type: 'hello', at: 1000, version: '1.0.0' })

    const snapshot = aggregator.getSnapshot()
    expect(snapshot?.source).toBe('both')
    expect(snapshot?.rooms[0].name).toBe('Kolnd Hub')
    expect(snapshot?.rooms[0].agent).toBe('general')
    expect(snapshot?.health.pluginConnected).toBe(true)
  })

  it('plugin sem ping há 15 s volta a ser desconectado e o poller manda', () => {
    const clock = clocked()
    const aggregator = createOfficeAggregator({
      now: clock.now,
      getDepartments: () => roomFor(['ses_1'])
    })
    const activity = new Map<string, OfficeActivity>([
      ['ses_1', { kind: 'shell', label: 'Executando npm test', at: 800 }]
    ])
    aggregator.setPoller(pollerSnapshot([session('ses_1')], 1000, activity))

    clock.set(1300)
    aggregator.applyEvent({
      type: 'tool',
      at: 1300,
      sessionID: 'ses_1',
      tool: { name: 'edit', status: 'running', filePath: 'auth.ts' }
    })
    expect(aggregator.getSnapshot()?.agents[0].activity?.label).toBe('Editando auth.ts')

    clock.set(1300 + PLUGIN_STALE_MS + 1)
    const stale = aggregator.getSnapshot()
    expect(stale?.health.pluginConnected).toBe(false)
    expect(stale?.source).toBe('poller')
    expect(stale?.agents[0].activity?.label).toBe('Executando npm test')
  })

  it('throttle de 4/s coalesce rajada e o flush entrega o estado final', () => {
    const clock = clocked()
    const aggregator = createOfficeAggregator({
      now: clock.now,
      getDepartments: () => roomFor(['ses_1'])
    })

    const first = aggregator.applyEvent({
      type: 'sessions',
      at: 1000,
      sessions: [{ id: 'ses_1', location: { directory: 'C:\\repo\\alpha' } }]
    })
    expect(first).not.toBeNull()

    clock.set(1000 + EMIT_MIN_INTERVAL_MS - 50)
    const blocked = aggregator.applyEvent({
      type: 'session',
      at: 1100,
      session: { id: 'ses_1', title: 'Título novo' }
    })
    expect(blocked).toBeNull()
    expect(aggregator.msUntilNextEmit()).toBe(50)

    clock.set(1000 + EMIT_MIN_INTERVAL_MS)
    const flushed = aggregator.flush()
    expect(flushed?.agents[0].title).toBe('Título novo')
    expect(aggregator.flush()).toBeNull()
    expect(aggregator.msUntilNextEmit()).toBe(0)
  })

  it('status busy do plugin sobrepõe sessão ociosa do poller', () => {
    const clock = clocked()
    const aggregator = createOfficeAggregator({
      now: clock.now,
      getDepartments: () => roomFor(['ses_1'])
    })
    aggregator.setPoller(
      pollerSnapshot([session('ses_1', { time: { created: 1, busy: 500, idle: 900 } })], 1000)
    )
    expect(aggregator.getSnapshot()?.agents[0].status).toBe('idle')

    clock.set(1300)
    aggregator.applyEvent({ type: 'status', at: 1300, sessionID: 'ses_1', status: 'busy' })

    expect(aggregator.getSnapshot()?.agents[0].status).toBe('working')
  })

  it('hello sozinho atualiza health sem inventar snapshot', () => {
    const aggregator = createOfficeAggregator({ now: () => 5000 })
    expect(aggregator.applyEvent({ type: 'hello', at: 5000, version: '1.0.0' })).toBeNull()
    expect(aggregator.getSnapshot()).toBeNull()
    expect(aggregator.pluginHealth()).toEqual({
      connected: true,
      version: '1.0.0',
      lastPingAt: 5000
    })
  })

  it('current() devolve o último snapshot sem recalcular staleness', () => {
    const clock = clocked()
    const aggregator = createOfficeAggregator({
      now: clock.now,
      getDepartments: () => roomFor(['ses_1'])
    })

    aggregator.applyEvent({
      type: 'sessions',
      at: 1000,
      sessions: [{ id: 'ses_1', title: 'Sessão atual', location: { directory: 'C:\\repo\\alpha' } }]
    })
    const current = aggregator.current()
    expect(current?.agents[0].title).toBe('Sessão atual')

    // 20 s depois o health ao vivo já caiu, mas `current()` é o último snapshot
    // mesclado (é o que o `office:subscribe` devolve sem reiniciar nada).
    clock.set(21_000)
    expect(aggregator.current()).toBe(current)
    expect(aggregator.getSnapshot()?.health.pluginConnected).toBe(false)
  })

  it('mantém no máximo 60 sessões e 40 itens de feed, descartando os mais antigos', () => {
    const clock = clocked()
    const sessions = Array.from({ length: 70 }, (_, index) => ({
      id: `ses_${index}`,
      title: `Sessão ${index}`,
      time: { created: 1000 + index, updated: 1000 + index },
      location: { directory: 'C:\\repo\\alpha' }
    }))
    const aggregator = createOfficeAggregator({
      now: clock.now,
      getDepartments: () => roomFor(sessions.map((item) => item.id))
    })

    aggregator.applyEvent({ type: 'sessions', at: 1000, sessions })

    // Cada ferramenta é de uma sessão distinta; as 60 mais novas sobrevivem.
    for (let index = 0; index < 70; index += 1) {
      clock.set(1100 + index * 300)
      aggregator.applyEvent({
        type: 'tool',
        at: 1100 + index * 300,
        sessionID: `ses_${index}`,
        tool: { name: 'shell', status: 'running', command: `npm run task-${index}` }
      })
    }

    const snapshot = aggregator.getSnapshot()
    expect(snapshot?.agents).toHaveLength(60)
    expect(snapshot?.agents.some((agent) => agent.sessionID === 'ses_0')).toBe(false)
    expect(snapshot?.agents.some((agent) => agent.sessionID === 'ses_69')).toBe(true)
    expect(snapshot?.feed).toHaveLength(40)
  })
})
