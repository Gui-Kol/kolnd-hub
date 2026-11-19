import { describe, expect, it } from 'vitest'
import {
  agentNameFor,
  agentSeedFor,
  deriveOfficeSnapshot,
  describeToolActivity,
  IDLE_VISIBLE_MS,
  maskSecrets,
  normalizeDirectory,
  REQUEST_MAX,
  toolActivityKind,
  truncateLabel,
  type OfficeActivity,
  type OfficePermissionRequest,
  type OfficeSessionInput
} from './office'
import { defaultLookFor } from './officeAvatar'

const NOW = 1_800_000_000_000

function session(overrides: Partial<OfficeSessionInput> & { id: string }): OfficeSessionInput {
  return {
    title: 'Sessão de teste',
    agent: 'general',
    model: { id: 'deepseek-v4.1-flash', providerID: 'opencode-go' },
    cost: 0,
    tokens: { input: 0, output: 0 },
    time: {},
    location: { directory: 'C:\\Users\\TiffoDi\\desenv\\Kolnd Hub' },
    ...overrides
  }
}

describe('deriveOfficeSnapshot — status', () => {
  it('busy sem idle ⇒ working', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [session({ id: 'ses_busy', time: { created: NOW - 5000, busy: NOW - 4000 } })]
    })
    expect(snapshot.agents[0].status).toBe('working')
  })

  it('idle >= busy ⇒ idle enquanto dentro da janela', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [
        session({
          id: 'ses_idle',
          time: { created: NOW - 9000, busy: NOW - 5000, idle: NOW - 2000 }
        })
      ]
    })
    expect(snapshot.agents[0].status).toBe('idle')
  })

  it('ocioso dentro dos 15 min ⇒ idle', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [
        session({
          id: 'ses_recente',
          time: { busy: NOW - 5 * 60_000 - 1000, idle: NOW - 5 * 60_000 }
        })
      ]
    })
    expect(snapshot.agents[0].status).toBe('idle')
  })

  it('ocioso exatamente no limite da janela ⇒ idle', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [
        session({
          id: 'ses_limite',
          time: { busy: NOW - IDLE_VISIBLE_MS - 1000, idle: NOW - IDLE_VISIBLE_MS }
        })
      ]
    })
    expect(snapshot.agents[0].status).toBe('idle')
  })

  it('ocioso 1 ms além da janela ⇒ ended (sessão antiga sai do escritório)', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [
        session({
          id: 'ses_antiga',
          time: { busy: NOW - IDLE_VISIBLE_MS - 1001, idle: NOW - IDLE_VISIBLE_MS - 1 }
        })
      ]
    })
    expect(snapshot.agents[0].status).toBe('ended')
  })

  it('sem busy e com idle antigo ⇒ ended', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [session({ id: 'ses_so_idle', time: { idle: NOW - 60 * 60_000 } })]
    })
    expect(snapshot.agents[0].status).toBe('ended')
  })

  it('outcome com busy antigo ⇒ ended (não fica "trabalhando" para sempre)', () => {
    const antigo = NOW - 2 * 24 * 60 * 60_000
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [
        session({
          id: 'ses_outcome_busy',
          outcome: 'succeeded',
          time: { created: antigo, busy: antigo }
        })
      ]
    })
    expect(snapshot.agents[0].status).toBe('ended')
  })

  it('idle mais antigo que busy ⇒ working', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [
        session({
          id: 'ses_working',
          time: { created: NOW - 9000, idle: NOW - 6000, busy: NOW - 1000 }
        })
      ]
    })
    expect(snapshot.agents[0].status).toBe('working')
  })

  it('outcome sem busy ⇒ ended', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [session({ id: 'ses_ended', outcome: 'succeeded', time: { created: NOW - 9000 } })]
    })
    expect(snapshot.agents[0].status).toBe('ended')
  })

  it('sem dados de tempo nem outcome ⇒ unknown', () => {
    const snapshot = deriveOfficeSnapshot({ now: NOW, sessions: [session({ id: 'ses_unknown' })] })
    expect(snapshot.agents[0].status).toBe('unknown')
  })

  it('permissão pendente (plugin) ⇒ needsYou, mesmo com busy', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      needsYouSessionIDs: ['ses_needs'],
      sessions: [session({ id: 'ses_needs', time: { busy: NOW - 1000 } })]
    })
    expect(snapshot.agents[0].status).toBe('needsYou')
    expect(snapshot.totals.needsYou).toBe(1)
    expect(snapshot.totals.working).toBe(0)
  })
})

describe('deriveOfficeSnapshot — salas e subagentes', () => {
  it('cada departamento vira uma sala com a função e os membros designados', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      departments: [
        {
          id: 'dep_0000beef',
          name: 'Gerentes',
          agentID: 'general',
          sessionIDs: ['ses_1', 'ses_2'],
          createdAt: NOW - 10_000
        },
        {
          id: 'dep_0000cafe',
          name: 'Build',
          agentID: 'build',
          sessionIDs: ['ses_3'],
          createdAt: NOW - 5_000
        }
      ],
      sessions: [
        session({
          id: 'ses_1',
          agent: 'general',
          location: { directory: 'C:\\Users\\TiffoDi\\desenv\\Kolnd Hub' }
        }),
        session({
          id: 'ses_2',
          agent: 'general',
          location: { directory: 'c:/Users/TiffoDi/desenv/Kolnd Hub/' }
        }),
        session({
          id: 'ses_3',
          agent: 'general',
          location: { directory: 'C:\\Users\\TiffoDi\\desenv\\outro-projeto' }
        })
      ]
    })

    expect(snapshot.rooms.map((room) => room.name)).toEqual(['Build', 'Gerentes'])
    const gerentes = snapshot.rooms.find((room) => room.id === 'dep_0000beef')
    expect(gerentes?.agent).toBe('general')
    expect(gerentes?.agentIDs).toEqual(['ses_1', 'ses_2'])
    // Todos os membros vêm da MESMA pasta (caixa/separadores diferentes): é a etiqueta.
    expect(gerentes?.path).toBe('C:\\Users\\TiffoDi\\desenv\\Kolnd Hub')
    expect(gerentes?.unassigned).toBeUndefined()

    // A função da sala ainda não chegou na sessão 3 (agente real `general`).
    const build = snapshot.agents.find((agent) => agent.sessionID === 'ses_3')
    expect(build?.rolePending).toBe('build')
    const member = snapshot.agents.find((agent) => agent.sessionID === 'ses_2')
    expect(member?.rolePending).toBeUndefined()
    expect(member?.roomID).toBe('dep_0000beef')
  })

  it('sessão sem departamento cai na sala sintética "Sem sala" (sempre no fim)', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      departments: [
        {
          id: 'dep_0000face',
          name: 'Build',
          agentID: 'build',
          sessionIDs: ['ses_dentro'],
          createdAt: NOW
        }
      ],
      sessions: [
        session({ id: 'ses_dentro', location: { directory: 'C:\\proj' } }),
        session({ id: 'ses_fora', location: { directory: 'C:\\outro' } }),
        session({ id: 'ses_sem_pasta', location: null })
      ]
    })

    expect(snapshot.rooms.map((room) => room.id)).toEqual(['dep_0000face', 'sem-sala'])
    const unassigned = snapshot.rooms.at(-1)
    expect(unassigned?.name).toBe('Sem sala')
    expect(unassigned?.unassigned).toBe(true)
    expect(unassigned?.agentIDs).toEqual(['ses_fora', 'ses_sem_pasta'])
    // Só quem tem pasta entra na etiqueta; com uma pasta única ela vira o path.
    expect(unassigned?.path).toBe('C:\\outro')
    expect(snapshot.agents.find((agent) => agent.sessionID === 'ses_fora')?.roomID).toBe('sem-sala')
  })

  it('departamento vazio continua visível e sessão designada a id inexistente cai em "Sem sala"', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      departments: [
        {
          id: 'dep_0000dead',
          name: 'Vazia',
          agentID: 'plan',
          sessionIDs: [],
          createdAt: NOW
        },
        {
          id: 'dep_0000f00d',
          name: 'Outra',
          agentID: 'build',
          sessionIDs: ['ses_nao_existe'],
          createdAt: NOW + 1
        }
      ],
      sessions: [session({ id: 'ses_1' })]
    })

    expect(snapshot.rooms.map((room) => room.id)).toEqual([
      'dep_0000f00d',
      'dep_0000dead',
      'sem-sala'
    ])
    expect(snapshot.rooms[0].agentIDs).toEqual([])
    expect(snapshot.agents[0].roomID).toBe('sem-sala')
  })

  it('parentID marca subagente e conta em totals.subagents', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [
        session({ id: 'ses_pai', time: { busy: NOW - 1000 } }),
        session({ id: 'ses_filho', parentID: 'ses_pai', time: { busy: NOW - 500 } })
      ]
    })
    const child = snapshot.agents.find((agent) => agent.sessionID === 'ses_filho')
    expect(child?.parentID).toBe('ses_pai')
    expect(snapshot.totals.subagents).toBe(1)
  })

  it('ordem estável: working → needsYou → idle → ended, empate por sessionID', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      needsYouSessionIDs: ['ses_needs'],
      sessions: [
        session({ id: 'ses_ended', outcome: 'succeeded' }),
        session({ id: 'ses_idle', time: { idle: NOW - 1000, busy: NOW - 2000 } }),
        session({ id: 'ses_needs' }),
        session({ id: 'ses_working_b', time: { busy: NOW - 1000 } }),
        session({ id: 'ses_working_a', time: { busy: NOW - 1000 } })
      ]
    })
    expect(snapshot.agents.map((agent) => agent.sessionID)).toEqual([
      'ses_working_a',
      'ses_working_b',
      'ses_needs',
      'ses_idle',
      'ses_ended'
    ])
  })

  it('snapshot vazio: sem agentes, totais zerados e health padrão', () => {
    const snapshot = deriveOfficeSnapshot({ now: NOW, sessions: [] })
    expect(snapshot.generatedAt).toBe(NOW)
    expect(snapshot.source).toBe('poller')
    expect(snapshot.agents).toEqual([])
    expect(snapshot.rooms).toEqual([])
    expect(snapshot.avatars).toEqual({})
    expect(snapshot.feed).toEqual([])
    expect(snapshot.totals).toEqual({
      working: 0,
      idle: 0,
      needsYou: 0,
      subagents: 0,
      cost: 0,
      tokens: 0
    })
    expect(snapshot.health).toEqual({ cliFound: true, pluginConnected: false })
  })

  it('health preserva cliPath e lastError quando informados', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [],
      health: {
        cliFound: false,
        cliPath: 'C:\\tools\\opencode-cli.exe',
        pluginConnected: true,
        lastError: 'CLI não encontrado'
      }
    })
    expect(snapshot.health).toEqual({
      cliFound: false,
      cliPath: 'C:\\tools\\opencode-cli.exe',
      pluginConnected: true,
      lastError: 'CLI não encontrado'
    })
  })
})

describe('deriveOfficeSnapshot — métricas e feed', () => {
  it('tokens somam input + output e custo soma por sessão', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [
        session({
          id: 'ses_a',
          cost: 0.25,
          tokens: { input: 1000, output: 250, cache: { read: 9999, write: 0 } }
        }),
        session({ id: 'ses_b', cost: 0.75, tokens: { input: 500, output: 100 } })
      ]
    })
    const agentA = snapshot.agents.find((agent) => agent.sessionID === 'ses_a')
    expect(agentA?.tokens).toEqual({ input: 1000, output: 250, total: 1250 })
    expect(snapshot.totals.cost).toBe(1)
    expect(snapshot.totals.tokens).toBe(1850)
  })

  it('feed guarda as 40 atividades mais recentes em ordem decrescente', () => {
    const activityBySession: Record<string, OfficeActivity> = {}
    for (let index = 0; index < 45; index++) {
      activityBySession[`ses_${index}`] = {
        kind: 'shell',
        label: `Atividade ${index}`,
        at: NOW - index * 1000
      }
    }
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [session({ id: 'ses_0' })],
      activityBySession
    })
    expect(snapshot.feed).toHaveLength(40)
    expect(snapshot.feed[0].at).toBe(NOW)
    expect(snapshot.feed.at(-1)?.at).toBe(NOW - 39 * 1000)
  })

  it('atividade da sessão entra no agente com o label mascarado', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [session({ id: 'ses_1' })],
      activityBySession: {
        ses_1: { kind: 'shell', label: 'Executando token=abcdef123456', at: NOW }
      }
    })
    expect(snapshot.agents[0].activity).toEqual({
      kind: 'shell',
      label: 'Executando token=***',
      at: NOW
    })
  })
})

describe('deriveOfficeSnapshot — pedidos de permissão', () => {
  function request(
    overrides: Partial<OfficePermissionRequest> & { id: string; sessionID: string }
  ): OfficePermissionRequest {
    return {
      action: 'shell',
      resources: ['npm run verify'],
      save: [],
      at: NOW - 1000,
      ...overrides
    }
  }

  it('pedido pendente marca a sessão como needsYou e entra em requests', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [session({ id: 'ses_pedido', time: { busy: NOW - 1000 } })],
      requests: [
        request({
          id: 'req_1',
          sessionID: 'ses_pedido',
          resources: ['npm run verify'],
          save: ['npm run verify'],
          at: NOW - 500
        })
      ]
    })

    expect(snapshot.agents[0].status).toBe('needsYou')
    expect(snapshot.totals.needsYou).toBe(1)
    expect(snapshot.requests).toEqual([
      {
        id: 'req_1',
        sessionID: 'ses_pedido',
        action: 'shell',
        resources: ['npm run verify'],
        save: ['npm run verify'],
        at: NOW - 500
      }
    ])
  })

  it('needsYouSessionIDs continua valendo junto com requests (compatibilidade)', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [
        session({ id: 'ses_lista', time: { busy: NOW - 1000 } }),
        session({ id: 'ses_pedido', time: { busy: NOW - 1000 } })
      ],
      needsYouSessionIDs: ['ses_lista'],
      requests: [request({ id: 'req_2', sessionID: 'ses_pedido' })]
    })

    const statuses = new Map(snapshot.agents.map((agent) => [agent.sessionID, agent.status]))
    expect(statuses.get('ses_lista')).toBe('needsYou')
    expect(statuses.get('ses_pedido')).toBe('needsYou')
    expect(snapshot.totals.needsYou).toBe(2)
  })

  it('ordena do mais recente ao mais antigo, deduplica por id e corta em 20', () => {
    const requests: OfficePermissionRequest[] = []
    for (let index = 0; index < REQUEST_MAX + 5; index++) {
      requests.push(
        request({
          id: `req_${index}`,
          sessionID: `ses_${index % 3}`,
          action: `ação ${index}`,
          at: NOW - index * 1000
        })
      )
    }
    // O mesmo id com um evento mais novo vence a cópia antiga.
    requests.push(
      request({
        id: 'req_5',
        sessionID: 'ses_2',
        action: 'ação atualizada',
        at: NOW + 1000
      })
    )

    const snapshot = deriveOfficeSnapshot({ now: NOW, sessions: [], requests })

    expect(snapshot.requests).toHaveLength(REQUEST_MAX)
    expect(snapshot.requests[0].id).toBe('req_5')
    expect(snapshot.requests[0].action).toBe('ação atualizada')
    expect(snapshot.requests.some((entry) => entry.id === 'req_24')).toBe(false)
    expect(new Set(snapshot.requests.map((entry) => entry.id)).size).toBe(REQUEST_MAX)
    const timestamps = snapshot.requests.map((entry) => entry.at)
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a))
  })

  it('mascara segredos, trunca recursos em 200 e salva a mensagem em ≤ 500', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [session({ id: 'ses_1' })],
      requests: [
        request({
          id: 'req_segredo',
          sessionID: 'ses_1',
          resources: [
            'curl -H "Authorization: Bearer abcdef123456" https://exemplo',
            'a'.repeat(500)
          ],
          message: 'm'.repeat(600)
        })
      ]
    })

    const [entry] = snapshot.requests
    expect(entry.resources[0]).toContain('Bearer ***')
    expect(entry.resources[0]).not.toContain('abcdef123456')
    expect(entry.resources[1]).toHaveLength(200)
    expect(entry.resources[1].endsWith('…')).toBe(true)
    expect(entry.message).toHaveLength(500)
  })

  it('sem pedidos (ou com requests presente e vazio) a fila vem vazia', () => {
    const withoutRequests = deriveOfficeSnapshot({ now: NOW, sessions: [] })
    expect(withoutRequests.requests).toEqual([])

    const explicitlyEmpty = deriveOfficeSnapshot({
      now: NOW,
      sessions: [session({ id: 'ses_1', time: { busy: NOW - 1000 } })],
      requests: []
    })
    expect(explicitlyEmpty.requests).toEqual([])
    expect(explicitlyEmpty.agents[0].status).toBe('working')
  })
})

describe('deriveOfficeSnapshot — aparência', () => {
  it('sessão sem look salvo recebe o padrão determinístico da seed', () => {
    const sessions = [session({ id: 'ses_look_a' }), session({ id: 'ses_look_b' })]
    const first = deriveOfficeSnapshot({ now: NOW, sessions })
    const second = deriveOfficeSnapshot({ now: NOW + 1000, sessions })

    expect(first.avatars).toEqual(second.avatars)
    expect(Object.keys(first.avatars)).toEqual(['ses_look_a', 'ses_look_b'])
    const agent = first.agents.find((entry) => entry.sessionID === 'ses_look_a')
    expect(first.avatars.ses_look_a).toEqual(defaultLookFor(agent?.seed ?? 0))
  })

  it('look persistido vence o padrão e um look inválido cai no padrão', () => {
    const saved = {
      sex: 'masculino' as const,
      hairStyle: 0,
      hairColor: 3,
      skin: 6,
      shirt: 9,
      pants: 7
    }
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [session({ id: 'ses_salvo' }), session({ id: 'ses_invalido' })],
      avatars: {
        ses_salvo: saved,
        ses_invalido: { ...saved, hairStyle: 99 } as never
      }
    })

    expect(snapshot.avatars.ses_salvo).toEqual(saved)
    const invalid = snapshot.agents.find((agent) => agent.sessionID === 'ses_invalido')
    expect(snapshot.avatars.ses_invalido).toEqual(defaultLookFor(invalid?.seed ?? 0))
  })

  it('departamentos duplicados ou inválidos não quebram a derivação', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      departments: [
        {
          id: 'dep_0000aaaa',
          name: 'Build',
          agentID: 'build',
          sessionIDs: ['ses_1', 'ses_1', '  '],
          createdAt: NOW
        },
        // Mesmo id: a segunda cópia é ignorada (primeira vence).
        {
          id: 'dep_0000aaaa',
          name: 'Outra',
          agentID: 'plan',
          sessionIDs: ['ses_1'],
          createdAt: NOW + 1
        },
        { id: '', name: '', agentID: '', sessionIDs: [], createdAt: 0 } as never
      ],
      sessions: [session({ id: 'ses_1' })]
    })

    expect(snapshot.rooms).toHaveLength(1)
    expect(snapshot.rooms[0].name).toBe('Build')
    expect(snapshot.rooms[0].agentIDs).toEqual(['ses_1'])
  })
})

describe('agentNameFor / agentSeedFor', () => {
  it('mesmo sessionID ⇒ sempre o mesmo nome e a mesma seed', () => {
    const first = agentNameFor('ses_e11144d50ffe')
    const second = agentNameFor('ses_e11144d50ffe')
    expect(first).toBe(second)
    expect(first.length).toBeGreaterThan(0)
    expect(agentSeedFor('ses_e11144d50ffe')).toBe(agentSeedFor('ses_e11144d50ffe'))
  })

  it('ids diferentes tendem a nomes diferentes (lista fixa, sem vazio)', () => {
    const names = new Set(
      ['ses_a', 'ses_b', 'ses_c', 'ses_d', 'ses_e'].map((id) => agentNameFor(id))
    )
    expect(names.size).toBeGreaterThan(1)
    for (const name of names) expect(name.trim()).not.toBe('')
  })
})

describe('normalizeDirectory', () => {
  it('minúsculas, barra normalizada e sem barra final', () => {
    expect(normalizeDirectory('C:\\Users\\TiffoDi\\Projeto\\')).toBe('c:/users/tiffodi/projeto')
    expect(normalizeDirectory('c:/Users/TiffoDi/Projeto')).toBe('c:/users/tiffodi/projeto')
    expect(normalizeDirectory(null)).toBe('sem-projeto')
  })
})

describe('maskSecrets', () => {
  it('mascara Bearer, prefixos de token e token=/senha=', () => {
    const text =
      'curl -H "Authorization: Bearer abcdef123456" sk-abcdef1234567890 ghp_abcdefgh12345 AKIAIOSFODNN7EXAMPLE token=abc123456 senha: hunter2'
    const masked = maskSecrets(text)
    expect(masked).not.toContain('abcdef123456')
    expect(masked).not.toContain('sk-abcdef1234567890')
    expect(masked).not.toContain('ghp_abcdefgh12345')
    expect(masked).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(masked).not.toContain('hunter2')
    expect(masked).toContain('Bearer ***')
    expect(masked).toContain('sk-***')
    expect(masked).toContain('ghp_***')
    expect(masked).toContain('AKIA***')
    expect(masked).toContain('token=***')
    expect(masked).toContain('senha: ***')
  })

  it('mascara credencial em URL e em -u usuario:senha', () => {
    expect(maskSecrets('git clone https://joao:segredo@example.com/repo.git')).toBe(
      'git clone https://***:***@example.com/repo.git'
    )
    expect(maskSecrets('git clone -u joao:segredo repo')).toContain('-u ***:***')
  })

  it('texto sem segredo passa intacto', () => {
    expect(maskSecrets('Executando npm test')).toBe('Executando npm test')
  })
})

describe('truncateLabel', () => {
  it('colapsa espaços e corta em ≤ 90 com reticências', () => {
    expect(truncateLabel('  Lendo\n   config.ts  ')).toBe('Lendo config.ts')
    const long = truncateLabel('a'.repeat(200))
    expect(long).toHaveLength(90)
    expect(long.endsWith('…')).toBe(true)
  })

  it('respeita um limite menor que o padrão', () => {
    expect(truncateLabel('1234567890abcdef', 10)).toBe('123456789…')
  })
})

describe('toolActivityKind / describeToolActivity', () => {
  it('mapeia as ferramentas do OpenCode para as categorias do contrato', () => {
    expect(toolActivityKind('read')).toBe('read')
    expect(toolActivityKind('glob')).toBe('read')
    expect(toolActivityKind('grep')).toBe('search')
    expect(toolActivityKind('search')).toBe('search')
    expect(toolActivityKind('edit')).toBe('edit')
    expect(toolActivityKind('write')).toBe('edit')
    expect(toolActivityKind('apply_patch')).toBe('edit')
    expect(toolActivityKind('shell')).toBe('shell')
    expect(toolActivityKind('bash')).toBe('shell')
    expect(toolActivityKind('webfetch')).toBe('web')
    expect(toolActivityKind('websearch')).toBe('web')
    expect(toolActivityKind('task')).toBe('think')
    expect(toolActivityKind('agent')).toBe('think')
    expect(toolActivityKind('qualquer-coisa')).toBe('other')
  })

  it('gera rótulos pt-BR curtos para os casos comuns', () => {
    expect(describeToolActivity('edit', { filePath: 'C:\\repo\\src\\auth.ts' })).toEqual({
      kind: 'edit',
      label: 'Editando auth.ts'
    })
    expect(describeToolActivity('shell', { command: 'npm test' })).toEqual({
      kind: 'shell',
      label: 'Executando npm test'
    })
    expect(describeToolActivity('read', { filePath: 'config.ts' })).toEqual({
      kind: 'read',
      label: 'Lendo config.ts'
    })
    expect(describeToolActivity('grep', { pattern: 'deriveOfficeSnapshot' }).kind).toBe('search')
    expect(describeToolActivity('ferramenta-nova').label).toBe('Usando ferramenta-nova')
  })

  it('o rótulo da ferramenta nunca carrega segredo', () => {
    const { label } = describeToolActivity('shell', {
      command: 'curl -H "Authorization: Bearer abcdef123456" https://api.exemplo'
    })
    expect(label).not.toContain('abcdef123456')
    expect(label).toContain('Bearer ***')
    expect(label.length).toBeLessThanOrEqual(90)
  })
})
