import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  createOfficeClient,
  latestToolActivity,
  locateOpencodeCli,
  OfficeCliError,
  parseApiJson,
  runApi,
  type CliExecError,
  type CliExecOptions,
  type ExecFileFn
} from './client'

interface Call {
  file: string
  args: readonly string[]
  options: CliExecOptions
}

interface FakeResult {
  error?: CliExecError | null
  stdout?: string
  stderr?: string
}

/** `execFile` falso: registra as chamadas e responde na microtask (nenhum processo real). */
function fakeExec(handler: (call: Call) => FakeResult): {
  fn: ExecFileFn
  calls: Call[]
} {
  const calls: Call[] = []
  const fn: ExecFileFn = (file, args, options, callback) => {
    const call = { file, args, options }
    calls.push(call)
    const result = handler(call)
    queueMicrotask(() => callback(result.error ?? null, result.stdout ?? '', result.stderr ?? ''))
  }
  return { fn, calls }
}

function execError(props: Partial<CliExecError> & { message?: string }): CliExecError {
  return Object.assign(new Error(props.message ?? 'falha'), props)
}

const CLI = 'C:\\fake\\opencode-cli.exe'

function createClient(handler: (call: Call) => FakeResult, timeoutMs?: number) {
  const fake = fakeExec(handler)
  const client = createOfficeClient({
    env: { KOLDND_HUB_OPENCODE_CLI: CLI },
    exists: () => true,
    execFileFn: fake.fn,
    timeoutMs
  })
  return { client, fake }
}

describe('locateOpencodeCli', () => {
  it('prefere KOLDND_HUB_OPENCODE_CLI quando o arquivo existe', async () => {
    const found = await locateOpencodeCli(
      { KOLDND_HUB_OPENCODE_CLI: CLI },
      { exists: (path) => path === CLI }
    )
    expect(found).toBe(CLI)
  })

  it('cai no CLI instalado com o app desktop (%LOCALAPPDATA%)', async () => {
    const localAppData = 'C:\\Users\\TiffoDi\\AppData\\Local'
    const expected = join(
      localAppData,
      'Programs',
      'ai.opencode.desktop',
      'resources',
      'opencode-cli.exe'
    )
    const found = await locateOpencodeCli(
      { LOCALAPPDATA: localAppData },
      { exists: (path) => path === expected, platform: 'win32' }
    )
    expect(found).toBe(expected)
  })

  it('por último resolve `opencode` no PATH com `where` (sem shell)', async () => {
    const fake = fakeExec(() => ({ stdout: 'C:\\tools\\opencode.exe\r\n' }))
    const found = await locateOpencodeCli(
      {},
      { exists: () => true, execFileFn: fake.fn, platform: 'win32' }
    )
    expect(found).toBe('C:\\tools\\opencode.exe')
    expect(fake.calls[0].file).toBe('where')
    expect(fake.calls[0].args).toEqual(['opencode'])
    expect(fake.calls[0].options.windowsHide).toBe(true)
  })

  it('devolve null quando nada é encontrado', async () => {
    const fake = fakeExec(() => ({ error: execError({ code: 1 }) }))
    const found = await locateOpencodeCli(
      {},
      { exists: () => false, execFileFn: fake.fn, platform: 'win32' }
    )
    expect(found).toBeNull()
  })

  it('ignora a variável de ambiente se o arquivo não existe', async () => {
    const fake = fakeExec(() => ({ error: execError({ code: 1 }) }))
    const found = await locateOpencodeCli(
      { KOLDND_HUB_OPENCODE_CLI: 'C:\\sumiu\\cli.exe' },
      { exists: () => false, execFileFn: fake.fn, platform: 'win32' }
    )
    expect(found).toBeNull()
  })
})

describe('parseApiJson', () => {
  it('recorta o objeto quando o CLI imprime uma linha de aviso antes', () => {
    expect(parseApiJson('aviso qualquer\n{"data":[1]}')).toEqual({ data: [1] })
  })

  it('rejeita saída vazia ou ilegível com erro tipado', () => {
    expect(() => parseApiJson('   ')).toThrow(OfficeCliError)
    try {
      parseApiJson('nada de json')
    } catch (err) {
      expect((err as OfficeCliError).code).toBe('jsonInvalido')
    }
  })
})

describe('runApi', () => {
  it('sem caminho do CLI falha como cliAusente antes de executar', async () => {
    const fake = fakeExec(() => ({}))
    await expect(runApi(['get', '/api/session'], { execFileFn: fake.fn })).rejects.toMatchObject({
      code: 'cliAusente'
    })
    expect(fake.calls).toHaveLength(0)
  })

  it('chama `api get …` com timeout, buffer e sem shell', async () => {
    const fake = fakeExec(() => ({ stdout: '{"data":{"ok":true}}' }))
    const data = await runApi(['get', '/api/session?limit=1'], {
      cliPath: CLI,
      timeoutMs: 1500,
      execFileFn: fake.fn
    })
    expect(data).toEqual({ ok: true })
    const call = fake.calls[0]
    expect(call.file).toBe(CLI)
    expect(call.args).toEqual(['api', 'get', '/api/session?limit=1'])
    expect(call.options).toEqual({
      windowsHide: true,
      timeout: 1500,
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8'
    })
    expect('shell' in call.options).toBe(false)
  })

  it('stderr sujo não invalida um stdout válido', async () => {
    const fake = fakeExec(() => ({
      stdout: '{"data":[{"id":"ses_1"}]}',
      stderr: 'aviso interno do CLI'
    }))
    const data = await runApi(['get', '/api/session'], { cliPath: CLI, execFileFn: fake.fn })
    expect(data).toEqual([{ id: 'ses_1' }])
  })

  it('exit ≠ 0 com JSON de erro no stdout vira `falhou` com a mensagem do CLI', async () => {
    const fake = fakeExec(() => ({
      error: execError({ code: 1 }),
      stdout: '{"error":{"message":"sessão não encontrada"}}',
      stderr: ''
    }))
    await expect(
      runApi(['get', '/api/session/ses_x/message'], { cliPath: CLI, execFileFn: fake.fn })
    ).rejects.toMatchObject({
      code: 'falhou',
      message: 'O CLI do OpenCode falhou: sessão não encontrada'
    })
  })

  it('JSON inválido vira `jsonInvalido`', async () => {
    const fake = fakeExec(() => ({ stdout: 'isto não é json' }))
    await expect(
      runApi(['get', '/api/session'], { cliPath: CLI, execFileFn: fake.fn })
    ).rejects.toMatchObject({ code: 'jsonInvalido' })
  })

  it('timeout vira `timeout` com mensagem legível', async () => {
    const fake = fakeExec(() => ({ error: execError({ killed: true, signal: 'SIGTERM' }) }))
    await expect(
      runApi(['get', '/api/session'], { cliPath: CLI, timeoutMs: 4000, execFileFn: fake.fn })
    ).rejects.toMatchObject({
      code: 'timeout',
      message: 'O CLI do OpenCode demorou mais de 4 s para responder.'
    })
  })

  it('binário ausente (ENOENT) vira `cliAusente`', async () => {
    const fake = fakeExec(() => ({ error: execError({ code: 'ENOENT' }) }))
    await expect(
      runApi(['get', '/api/session'], { cliPath: CLI, execFileFn: fake.fn })
    ).rejects.toMatchObject({ code: 'cliAusente' })
  })
})

describe('createOfficeClient', () => {
  it('listSessions monta o limite/busca e devolve as sessões', async () => {
    const { client, fake } = createClient(() => ({
      stdout: JSON.stringify({
        data: [
          {
            id: 'ses_1',
            title: 'Dedupe IPC',
            location: { directory: 'C:\\Users\\TiffoDi\\desenv\\Kolnd Hub' }
          },
          { semID: true }
        ],
        cursor: {}
      })
    }))
    const sessions = await client.listSessions({ limit: 12, search: 'abc def' })
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('ses_1')
    expect(fake.calls[0].args).toEqual([
      'api',
      'get',
      '/api/session?limit=12&archived=false&search=abc%20def'
    ])
    expect(client.cliPath()).toBe(CLI)
  })

  it('normaliza limite fora da faixa', async () => {
    const { client, fake } = createClient(() => ({ stdout: '{"data":[]}' }))
    await client.listSessions({ limit: 999 })
    expect(fake.calls[0].args[2]).toBe('/api/session?limit=200&archived=false')
  })

  it('includeArchived pede explicitamente as arquivadas', async () => {
    const { client, fake } = createClient(() => ({ stdout: '{"data":[]}' }))
    await client.listSessions({ includeArchived: true })
    expect(fake.calls[0].args[2]).toBe('/api/session?limit=50&archived=true')
  })

  it('`data` em formato inesperado vira `jsonInvalido`', async () => {
    const { client } = createClient(() => ({ stdout: '{"data":{"sessões":[]}}' }))
    await expect(client.listSessions()).rejects.toMatchObject({ code: 'jsonInvalido' })
  })

  it('sessionMessages usa o id codificado e o limite pedido', async () => {
    const { client, fake } = createClient(() => ({
      stdout: JSON.stringify({
        data: [
          {
            id: 'msg_1',
            time: { created: 100 },
            content: [
              { type: 'text', text: 'oi' },
              {
                type: 'tool',
                name: 'shell',
                state: { status: 'running', input: { command: 'npm run verify' } },
                time: { created: 200 }
              }
            ]
          }
        ]
      })
    }))
    const messages = await client.sessionMessages('ses_a/b', { limit: 3 })
    expect(fake.calls[0].args[2]).toBe('/api/session/ses_a%2Fb/message?limit=3')
    expect(messages[0].content?.[1].name).toBe('shell')
    expect(latestToolActivity(messages, 999)).toEqual({
      kind: 'shell',
      label: 'Executando npm run verify',
      at: 200
    })
  })

  it('sem CLI localizável, listSessions falha como cliAusente', async () => {
    const fake = fakeExec(() => ({ error: execError({ code: 1 }) }))
    const client = createOfficeClient({
      env: {},
      exists: () => false,
      execFileFn: fake.fn,
      platform: 'win32'
    })
    await expect(client.listSessions()).rejects.toMatchObject({ code: 'cliAusente' })
  })
})

describe('Gestão de funcionários (client)', () => {
  const DIRECTORY = 'C:\\repo\\alpha'

  it('runApi aceita --header e corpo vazio com allowEmpty', async () => {
    const fake = fakeExec(() => ({ stdout: '' }))
    await runApi(['get', '/api/agent'], {
      cliPath: CLI,
      headers: ['x-opencode-directory: C:\\repo'],
      allowEmpty: true,
      execFileFn: fake.fn
    })
    expect(fake.calls[0].args).toEqual([
      'api',
      'get',
      '/api/agent',
      '-H',
      'x-opencode-directory: C:\\repo'
    ])

    const data = await runApi(['patch', '/api/session/ses_1'], {
      cliPath: CLI,
      execFileFn: fakeExec(() => ({ stdout: '{"data":{"ok":true}}' })).fn
    })
    expect(data).toEqual({ ok: true })
  })

  it('listAgents/listModels usam o cabeçalho do projeto', async () => {
    const agentsCall = createClient(() => ({
      stdout: JSON.stringify({
        data: [
          { id: 'build', name: 'Build', mode: 'primary', hidden: false },
          { id: 'oculto', name: 'Oculto', mode: 'primary', hidden: true }
        ]
      })
    }))
    const agents = await agentsCall.client.listAgents(DIRECTORY)
    expect(agents.map((agent) => agent.id)).toEqual(['build'])
    expect(agentsCall.fake.calls[0].args).toEqual([
      'api',
      'get',
      '/api/agent',
      '-H',
      `x-opencode-directory: ${DIRECTORY}`
    ])

    const modelsCall = createClient(() => ({
      stdout: JSON.stringify({
        data: [{ providerID: 'opencode-go', id: 'qwen4-max', name: 'Qwen4 Max', enabled: true }]
      })
    }))
    const models = await modelsCall.client.listModels(DIRECTORY)
    expect(models[0]).toMatchObject({ providerID: 'opencode-go', id: 'qwen4-max' })
    expect(modelsCall.fake.calls[0].args[2]).toBe('/api/model')
  })

  it('createSession monta o corpo exato e devolve o id novo', async () => {
    const { client, fake } = createClient(() => ({
      stdout: JSON.stringify({ data: { id: 'ses_novo123', title: 'Contratar dev' } })
    }))
    const id = await client.createSession({
      title: 'Contratar dev',
      agentID: 'build',
      model: null,
      directory: DIRECTORY
    })

    expect(id).toBe('ses_novo123')
    expect(fake.calls[0].args).toEqual([
      'api',
      'post',
      '/api/session',
      '--data',
      JSON.stringify({
        title: 'Contratar dev',
        agent: 'build',
        location: { directory: DIRECTORY }
      }),
      '-H',
      `x-opencode-directory: ${DIRECTORY}`
    ])
    expect(fake.calls[0].options.timeout).toBe(10_000)
  })

  it('createSession inclui o modelo escolhido e recusa resposta sem id válido', async () => {
    const withModel = createClient(() => ({
      stdout: JSON.stringify({ data: { id: 'ses_com_modelo' } })
    }))
    await withModel.client.createSession({
      title: 'Contratar dev',
      agentID: 'build',
      model: { providerID: 'opencode-go', id: 'qwen4-max', name: 'Qwen', enabled: true },
      directory: DIRECTORY
    })
    const body = JSON.parse(withModel.fake.calls[0].args[4]) as Record<string, unknown>
    expect(body.model).toEqual({ id: 'qwen4-max', providerID: 'opencode-go' })

    const broken = createClient(() => ({ stdout: JSON.stringify({ data: { nada: true } }) }))
    await expect(
      broken.client.createSession({
        title: 'Contratar dev',
        agentID: 'build',
        model: null,
        directory: DIRECTORY
      })
    ).rejects.toMatchObject({ code: 'jsonInvalido' })
  })

  it('setSessionAgent/setSessionModel aceitam 204 e montam o corpo', async () => {
    const { client, fake } = createClient(() => ({ stdout: '' }))
    await client.setSessionAgent('ses_1', 'plan')
    expect(fake.calls[0].args).toEqual([
      'api',
      'post',
      '/api/session/ses_1/agent',
      '--data',
      '{"agent":"plan"}'
    ])

    await client.setSessionModel('ses_1', { providerID: 'opencode-go', id: 'qwen4-max' })
    expect(fake.calls[1].args).toEqual([
      'api',
      'post',
      '/api/session/ses_1/model',
      '--data',
      '{"model":{"providerID":"opencode-go","id":"qwen4-max"}}'
    ])
  })

  it('archive/restore usam PATCH { archived } e não exigem corpo', async () => {
    const { client, fake } = createClient(() => ({ stdout: '' }))
    await client.archiveSession('ses_1')
    await client.restoreSession('ses_1')

    expect(fake.calls[0].args).toEqual([
      'api',
      'patch',
      '/api/session/ses_1',
      '--data',
      '{"archived":true}'
    ])
    expect(fake.calls[1].args).toEqual([
      'api',
      'patch',
      '/api/session/ses_1',
      '--data',
      '{"archived":false}'
    ])
  })

  it('listArchivedSessions filtra pela query e normaliza as linhas', async () => {
    const { client, fake } = createClient(() => ({
      stdout: JSON.stringify({
        data: [
          {
            id: 'ses_arq',
            title: 'Antiga',
            agent: 'plan',
            model: { providerID: 'opencode-go', id: 'qwen4-max' },
            location: { directory: DIRECTORY }
          }
        ]
      })
    }))
    const list = await client.listArchivedSessions(DIRECTORY)
    expect(fake.calls[0].args).toEqual([
      'api',
      'get',
      '/api/session?archived=true&limit=100',
      '-H',
      `x-opencode-directory: ${DIRECTORY}`
    ])
    expect(list[0]).toMatchObject({ sessionID: 'ses_arq', title: 'Antiga', agent: 'plan' })
  })

  it('recusa id/agente/modelo inválidos antes de executar o CLI', async () => {
    const { client, fake } = createClient(() => ({ stdout: '' }))
    await expect(client.archiveSession('sessao')).rejects.toMatchObject({ code: 'falhou' })
    await expect(client.setSessionAgent('ses_1', 'a/b')).rejects.toMatchObject({ code: 'falhou' })
    await expect(
      client.setSessionModel('ses_1', { providerID: '', id: 'x' })
    ).rejects.toMatchObject({ code: 'falhou' })
    await expect(client.listAgents('C:\\repo\nx')).rejects.toMatchObject({ code: 'falhou' })
    expect(fake.calls).toHaveLength(0)
  })
})

describe('latestToolActivity', () => {
  it('pega a ferramenta mais recente da última mensagem e mascara segredo', () => {
    const activity = latestToolActivity(
      [
        {
          time: { created: 10 },
          content: [{ type: 'tool', name: 'read', time: { created: 20 } }]
        },
        {
          time: { created: 30 },
          content: [
            { type: 'text' },
            {
              type: 'tool',
              name: 'shell',
              state: { status: 'running', input: { command: 'curl -H "Bearer abcdef123456"' } },
              time: { created: 40 }
            }
          ]
        }
      ],
      999
    )
    expect(activity?.kind).toBe('shell')
    expect(activity?.at).toBe(40)
    expect(activity?.label).not.toContain('abcdef123456')
  })

  it('sem parte de ferramenta devolve undefined', () => {
    expect(latestToolActivity([{ content: [{ type: 'text' }] }], 1)).toBeUndefined()
    expect(latestToolActivity([], 1)).toBeUndefined()
  })
})
