import { describe, expect, it } from 'vitest'
import {
  buildCreateSessionBody,
  isValidAgentID,
  isValidDirectory,
  isValidSessionID,
  normalizeArchiveAllInput,
  normalizeHireInput,
  normalizeHireTitle,
  normalizeRestoreInput,
  normalizeRosterOptionsInput,
  normalizeSetRoleInput,
  parseAgentList,
  parseArchivedList,
  parseModelList,
  pickArchiveTargets
} from './roster'

/** Regras puras da gestão de funcionários — sem processo, sem arquivo, sem Electron. */

describe('parseAgentList', () => {
  it('aceita o envelope { data } e descarta escondidos, duplicados e inválidos', () => {
    const agents = parseAgentList({
      location: { directory: 'C:\\repo' },
      data: [
        { id: 'plan', name: 'Planejar', mode: 'primary', hidden: false },
        { id: 'general', name: 'General', mode: 'subagent', hidden: false },
        { id: 'oculto', name: 'Oculto', mode: 'primary', hidden: true },
        { id: 'plan', name: 'Duplicado', mode: 'primary' },
        { id: 'id inválido', name: 'X', mode: 'primary' },
        { id: 'build', mode: 'primary' }
      ]
    })

    expect(agents.map((agent) => agent.id)).toEqual(['build', 'general', 'plan'])
    expect(agents[0]).toMatchObject({ id: 'build', name: 'build', mode: 'primary' })
    expect(agents[2]).toMatchObject({ id: 'plan', name: 'Planejar', mode: 'primary' })
  })

  it('modo desconhecido vira "all" e descrição aparece quando legível', () => {
    const [agent] = parseAgentList([
      { id: 'gerente', name: 'Gerente', mode: 'novo-modo', description: 'Coordena  a  equipe' }
    ])
    expect(agent.mode).toBe('all')
    expect(agent.description).toBe('Coordena a equipe')
  })

  it('formato inesperado devolve lista vazia (tolerante)', () => {
    expect(parseAgentList(null)).toEqual([])
    expect(parseAgentList({ data: 'nada' })).toEqual([])
    expect(parseAgentList([null, 1, 'x'])).toEqual([])
  })
})

describe('parseModelList', () => {
  it('normaliza provider/modelo, deduplica e ordena por nome', () => {
    const models = parseModelList({
      data: [
        {
          providerID: 'opencode-go',
          id: 'qwen4-max',
          name: 'Qwen4 Max',
          enabled: true,
          variants: [{ id: 'none' }, { id: 'low' }, { id: 'high' }, { id: 'xhigh' }]
        },
        { providerID: 'opencode', id: 'tidepool-alpha-free', name: 'Tidepool', enabled: false },
        { providerID: 'opencode-go', id: 'qwen4-max', name: 'Repetido', enabled: true },
        { providerID: '', id: 'sem-provider', name: 'X', enabled: true },
        { providerID: 'openrouter', id: 'anthropic/claude-3.5', name: 'Claude', enabled: true }
      ]
    })

    expect(models.map((model) => `${model.providerID}/${model.id}`)).toEqual([
      'openrouter/anthropic/claude-3.5',
      'opencode-go/qwen4-max',
      'opencode/tidepool-alpha-free'
    ])
    expect(models[1].name).toBe('Qwen4 Max')
    expect(models[2].enabled).toBe(false)
    expect(models[1].variants).toEqual(['none', 'low', 'high', 'xhigh'])
    expect(models[2].variants).toEqual([])
  })

  it('sem nome usa provider/id; ausência de enabled conta como habilitado', () => {
    const [model] = parseModelList([{ providerID: 'openai', id: 'gpt-x' }])
    expect(model).toEqual({
      providerID: 'openai',
      id: 'gpt-x',
      name: 'openai/gpt-x',
      enabled: true,
      variants: []
    })
  })
})

describe('parseArchivedList', () => {
  it('recorta título/agente/modelo e ignora id fora do contrato', () => {
    const employees = parseArchivedList({
      data: [
        {
          id: 'ses_arq1',
          title: '  Revisar\n  contrato  ',
          agent: 'plan',
          model: { providerID: 'opencode-go', id: 'qwen4-max' },
          location: { directory: 'C:\\repo\\alpha' }
        },
        { id: 'sessao-invalida', title: 'Não entra' },
        { id: 'ses_arq1', title: 'Duplicado' }
      ]
    })

    expect(employees).toHaveLength(1)
    expect(employees[0]).toEqual({
      sessionID: 'ses_arq1',
      title: 'Revisar contrato',
      agent: 'plan',
      model: { providerID: 'opencode-go', id: 'qwen4-max' },
      directory: 'C:\\repo\\alpha'
    })
  })

  it('campos ausentes viram defaults legíveis', () => {
    const [employee] = parseArchivedList([{ id: 'ses_x' }])
    expect(employee.title).toBe('Sessão sem título')
    expect(employee.agent).toBe('desconhecido')
    expect(employee.model).toEqual({ providerID: '', id: '' })
    expect(employee.directory).toBe('')
  })
})

describe('validadores', () => {
  it('título: 1–80, sem controles e com espaços normalizados', () => {
    expect(normalizeHireTitle('  Contratar   dev ')).toBe('Contratar dev')
    expect(normalizeHireTitle('')).toBeNull()
    expect(normalizeHireTitle('   ')).toBeNull()
    expect(normalizeHireTitle('x'.repeat(81))).toBeNull()
    expect(normalizeHireTitle('linha\nquebrada')).toBe('linha quebrada')
  })

  it('agentID e sessionID seguem os formatos do OpenCode', () => {
    expect(isValidAgentID('build')).toBe(true)
    expect(isValidAgentID('meu.agente-1')).toBe(true)
    expect(isValidAgentID('com espaco')).toBe(false)
    expect(isValidAgentID('x'.repeat(65))).toBe(false)
    expect(isValidSessionID('ses_abc123')).toBe(true)
    expect(isValidSessionID('ses_2e2e_office_main')).toBe(true)
    expect(isValidSessionID('sessao')).toBe(false)
    expect(isValidSessionID('ses_')).toBe(false)
  })

  it('diretório precisa ser absoluto e sem controles', () => {
    expect(isValidDirectory('C:\\Users\\TiffoDi\\projeto')).toBe(true)
    expect(isValidDirectory('c:/Users/TiffoDi/projeto')).toBe(true)
    expect(isValidDirectory('\\\\servidor\\share\\projeto')).toBe(true)
    expect(isValidDirectory('/home/kolnd/projeto')).toBe(true)
    expect(isValidDirectory('projeto/local')).toBe(false)
    expect(isValidDirectory('C:relativo')).toBe(false)
    expect(isValidDirectory('')).toBe(false)
    expect(isValidDirectory('C:\\x\u0000y')).toBe(false)
  })
})

describe('normalizeHireInput', () => {
  const base = {
    title: 'Contratar dev',
    agentID: 'build',
    model: null,
    directory: 'C:\\repo\\alpha',
    departmentID: 'dep_0000a001'
  }

  it('aceita model null e normaliza o caminho', () => {
    expect(normalizeHireInput({ ...base, directory: '  C:\\repo\\alpha  ' })).toEqual({
      ...base,
      directory: 'C:\\repo\\alpha',
      departmentID: 'dep_0000a001'
    })
  })

  it('aceita modelo escolhido com name/enabled padrão', () => {
    const parsed = normalizeHireInput({
      ...base,
      model: { providerID: 'opencode-go', id: 'qwen4-max' }
    })
    expect(parsed?.model).toEqual({
      providerID: 'opencode-go',
      id: 'qwen4-max',
      name: 'opencode-go/qwen4-max',
      enabled: true,
      variants: []
    })
  })

  it('recusa chave extra, título longo, diretório relativo e modelo inválido', () => {
    expect(normalizeHireInput({ ...base, extra: 1 })).toBeNull()
    expect(normalizeHireInput({ ...base, title: 'x'.repeat(81) })).toBeNull()
    expect(normalizeHireInput({ ...base, title: 42 })).toBeNull()
    expect(normalizeHireInput({ ...base, agentID: 'com espaço' })).toBeNull()
    expect(normalizeHireInput({ ...base, directory: 'repo' })).toBeNull()
    expect(normalizeHireInput({ ...base, model: { providerID: '', id: 'x' } })).toBeNull()
    expect(normalizeHireInput(null)).toBeNull()
    expect(normalizeHireInput([])).toBeNull()
  })
})

describe('normalizeSetRoleInput', () => {
  it('aceita modelo ausente como "manter atual"', () => {
    expect(normalizeSetRoleInput({ sessionID: 'ses_1', agentID: 'plan' })).toEqual({
      sessionID: 'ses_1',
      agentID: 'plan',
      model: null
    })
  })

  it('aceita modelo explícito e recusa sessão/agente inválidos', () => {
    expect(
      normalizeSetRoleInput({
        sessionID: 'ses_1',
        agentID: 'plan',
        model: { providerID: 'opencode-go', id: 'qwen4-max', name: 'Qwen', enabled: true }
      })?.model?.id
    ).toBe('qwen4-max')

    expect(
      normalizeSetRoleInput({
        sessionID: 'ses_1',
        agentID: 'plan',
        model: {
          providerID: 'opencode-go',
          id: 'qwen4-max',
          name: 'Qwen',
          enabled: true,
          variants: ['none', 'low', 'high', 'xhigh'],
          variant: 'xhigh'
        }
      })?.model?.variant
    ).toBe('xhigh')
    expect(
      normalizeSetRoleInput({
        sessionID: 'ses_1',
        agentID: 'plan',
        model: { providerID: 'opencode-go', id: 'qwen4-max', variant: 'a/b' }
      })
    ).toBeNull()
    expect(normalizeSetRoleInput({ sessionID: 'abc', agentID: 'plan' })).toBeNull()
    expect(normalizeSetRoleInput({ sessionID: 'ses_1', agentID: 'a/b' })).toBeNull()
    expect(normalizeSetRoleInput({ sessionID: 'ses_1', agentID: 'plan', extra: 1 })).toBeNull()
  })
})

describe('inputs sem payload', () => {
  it('roster-options exige { directory } absoluto', () => {
    expect(normalizeRosterOptionsInput({ directory: 'C:\\repo' })).toEqual({
      directory: 'C:\\repo'
    })
    expect(normalizeRosterOptionsInput({ directory: 'repo' })).toBeNull()
    expect(normalizeRosterOptionsInput({ directory: 'C:\\repo', extra: true })).toBeNull()
  })

  it('restore exige { sessionID } e archive-all exige objeto vazio', () => {
    expect(normalizeRestoreInput({ sessionID: 'ses_1' })).toEqual({ sessionID: 'ses_1' })
    expect(normalizeRestoreInput({ sessionID: 'outra' })).toBeNull()
    expect(normalizeRestoreInput({ sessionID: 'ses_1', all: true })).toBeNull()
    expect(normalizeArchiveAllInput({})).toEqual({})
    expect(normalizeArchiveAllInput({ arquivar: true })).toBeNull()
    expect(normalizeArchiveAllInput(null)).toBeNull()
  })
})

describe('buildCreateSessionBody', () => {
  it('manda título, agente, sala e só inclui modelo quando escolhido', () => {
    const body = buildCreateSessionBody({
      title: 'Contratar dev',
      agentID: 'build',
      model: null,
      directory: 'C:\\repo\\alpha',
      departmentID: 'dep_0000a001'
    })
    expect(body).toEqual({
      title: 'Contratar dev',
      agent: 'build',
      location: { directory: 'C:\\repo\\alpha' }
    })

    const withModel = buildCreateSessionBody({
      title: 'Contratar dev',
      agentID: 'build',
      model: {
        providerID: 'opencode-go',
        id: 'qwen4-max',
        name: 'Qwen',
        enabled: true,
        variants: ['none', 'low', 'high', 'xhigh']
      },
      directory: 'C:\\repo\\alpha',
      departmentID: 'dep_0000a001'
    })
    expect(withModel.model).toEqual({ id: 'qwen4-max', providerID: 'opencode-go' })
  })
})

describe('pickArchiveTargets', () => {
  it('arquiva todos menos quem está trabalhando — que é contado como pulado', () => {
    const result = pickArchiveTargets([
      { sessionID: 'ses_working', status: 'working' },
      { sessionID: 'ses_idle', status: 'idle' },
      { sessionID: 'ses_needs', status: 'needsYou' },
      { sessionID: 'ses_ended', status: 'ended' },
      { sessionID: 'ses_idle', status: 'idle' }
    ])
    expect(result.targetIDs).toEqual(['ses_idle', 'ses_needs', 'ses_ended'])
    expect(result.skippedIDs).toEqual(['ses_working'])
  })

  it('lista vazia não produz alvos nem pulados', () => {
    expect(pickArchiveTargets([])).toEqual({ targetIDs: [], skippedIDs: [] })
  })
})
