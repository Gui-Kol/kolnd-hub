import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ACTION_MAX_PENDING, ACTION_TTL_MS, createOfficeBridge, type OfficeBridge } from './bridge'
import type { OfficeActionEnqueueResult, OfficeActionOutcome } from './actions'
import type { OfficePluginEvent } from './pluginSource'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function permissionAction(sessionID = 'ses_1'): Record<string, unknown> {
  return {
    action: 'permission.reply',
    sessionID,
    requestID: 'per_1',
    decision: 'once'
  }
}

function enqueuedID(result: OfficeActionEnqueueResult): string {
  if (!result.ok) throw new Error(`esperava ação enfileirada, veio ${result.reason}`)
  return result.id
}

interface HttpResult {
  status: number
  body: unknown
}

function request(options: {
  port: number
  path: string
  method: 'GET' | 'POST'
  token?: string
  host?: string
  body?: string
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {}
    if (options.host) headers.host = options.host
    if (options.token) headers['x-kolnd-token'] = options.token
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: options.method,
        headers
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let body: unknown = text
          try {
            body = text ? JSON.parse(text) : null
          } catch {
            // mantém texto
          }
          resolve({ status: res.statusCode ?? 0, body })
        })
      }
    )
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

function toolEvent(sessionID: string, at = 1000): OfficePluginEvent {
  return {
    type: 'tool',
    at,
    sessionID,
    tool: { name: 'shell', status: 'running', command: 'npm test' }
  }
}

describe('createOfficeBridge', () => {
  let bridge: OfficeBridge | null = null
  let userDataDir = ''

  afterEach(async () => {
    if (bridge) await bridge.stop()
    bridge = null
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true })
    userDataDir = ''
  })

  function setup(now?: () => number) {
    userDataDir = mkdtempSync(join(tmpdir(), 'kolnd-office-bridge-'))
    const events: OfficePluginEvent[] = []
    const results: Array<{ result: OfficeActionOutcome; action: string; sessionID: string }> = []
    bridge = createOfficeBridge({
      emit: (event) => events.push(event),
      onActionResult: (result, meta) =>
        results.push({ result, action: meta.action, sessionID: meta.sessionID }),
      userDataDir,
      ...(now ? { now } : {})
    })
    return { events, results }
  }

  it('grava o bridge.json no start e apaga no stop; start é idempotente', async () => {
    setup()
    const first = await bridge!.start()
    const second = await bridge!.start()
    expect(second).toEqual(first)
    expect(first.port).toBeGreaterThan(0)
    expect(first.token.length).toBeGreaterThan(20)

    const file = join(userDataDir, 'office', 'bridge.json')
    const written = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(written).toMatchObject({
      port: first.port,
      token: first.token,
      version: first.version,
      startedAt: first.startedAt
    })
    expect(Object.keys(written).sort()).toEqual(['port', 'startedAt', 'token', 'version'])
    // 0600 é best-effort (no Windows o mode pode não refletir); o arquivo existe.
    expect(statSync(file).isFile()).toBe(true)

    await bridge!.stop()
    bridge = null
    expect(() => readFileSync(file, 'utf8')).toThrow()
  })

  it('POST válido aceita lote e entrega os eventos ao agregador', async () => {
    const { events } = setup()
    const info = await bridge!.start()

    const result = await request({
      port: info.port,
      path: '/office/events',
      method: 'POST',
      token: info.token,
      body: JSON.stringify({ events: [toolEvent('ses_1'), toolEvent('ses_2', 1001)] })
    })

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, accepted: 2 })
    expect(events.map((event) => (event.type === 'tool' ? event.sessionID : ''))).toEqual([
      'ses_1',
      'ses_2'
    ])
  })

  it('token ausente/errado responde 401 (inclusive no hello)', async () => {
    const { events } = setup()
    const info = await bridge!.start()

    const missing = await request({
      port: info.port,
      path: '/office/events',
      method: 'POST',
      body: JSON.stringify(toolEvent('ses_1'))
    })
    expect(missing.status).toBe(401)

    const wrong = await request({
      port: info.port,
      path: '/office/events',
      method: 'POST',
      token: 'a'.repeat(info.token.length),
      body: JSON.stringify(toolEvent('ses_1'))
    })
    expect(wrong.status).toBe(401)

    const hello = await request({
      port: info.port,
      path: '/office/hello',
      method: 'GET'
    })
    expect(hello.status).toBe(401)
    expect(events).toHaveLength(0)
  })

  it('Host não-local responde 403 (anti DNS-rebinding)', async () => {
    setup()
    const info = await bridge!.start()

    const result = await request({
      port: info.port,
      path: '/office/events',
      method: 'POST',
      host: 'evil.example',
      token: info.token,
      body: JSON.stringify(toolEvent('ses_1'))
    })
    expect(result.status).toBe(403)

    // localhost também é aceito como Host.
    const localhost = await request({
      port: info.port,
      path: '/office/events',
      method: 'POST',
      host: `localhost:${info.port}`,
      token: info.token,
      body: JSON.stringify(toolEvent('ses_1'))
    })
    expect(localhost.status).toBe(200)
  })

  it('corpo acima de 32 KB responde 413 sem ingerir evento', async () => {
    const { events } = setup()
    const info = await bridge!.start()

    const result = await request({
      port: info.port,
      path: '/office/events',
      method: 'POST',
      token: info.token,
      body: JSON.stringify({ events: [toolEvent('ses_1')], padding: 'x'.repeat(40 * 1024) })
    })

    expect(result.status).toBe(413)
    expect(events).toHaveLength(0)
  })

  it('limite de 200 eventos/min descarta o excedente com 429', async () => {
    const { events } = setup()
    const info = await bridge!.start()

    const first = Array.from({ length: 100 }, (_, index) => toolEvent(`ses_${index}`))
    const second = Array.from({ length: 100 }, (_, index) => toolEvent(`ses_b${index}`))

    const batch1 = await request({
      port: info.port,
      path: '/office/events',
      method: 'POST',
      token: info.token,
      body: JSON.stringify({ events: first })
    })
    const batch2 = await request({
      port: info.port,
      path: '/office/events',
      method: 'POST',
      token: info.token,
      body: JSON.stringify({ events: second })
    })
    const overflow = await request({
      port: info.port,
      path: '/office/events',
      method: 'POST',
      token: info.token,
      body: JSON.stringify(toolEvent('ses_overflow'))
    })

    expect(batch1.status).toBe(200)
    expect(batch2.status).toBe(200)
    expect(overflow.status).toBe(429)
    expect(events).toHaveLength(200)
  })

  it('GET /office/hello devolve versão/uptime e marca o plugin', async () => {
    let clock = 1000
    const { events } = setup(() => clock)
    const info = await bridge!.start()
    clock = 1500

    const result = await request({
      port: info.port,
      path: '/office/hello?version=1.2.3',
      method: 'GET',
      token: info.token
    })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true, version: '1.2.3', uptimeMs: 500 })
    expect(events).toEqual([{ type: 'hello', at: 1500, version: '1.2.3' }])
  })

  it('escuta somente em loopback e recusa evento inválido', async () => {
    const { events } = setup()
    const info = await bridge!.start()

    expect(bridge!.address()).toEqual({ address: '127.0.0.1', port: info.port })
    expect(bridge!.ingestEvent({ type: 'nope', at: 1 })).toBe(false)
    expect(bridge!.ingestEvent(toolEvent('ses_local'))).toBe(true)
    expect(events).toHaveLength(1)

    const invalid = await request({
      port: info.port,
      path: '/office/events',
      method: 'POST',
      token: info.token,
      body: JSON.stringify({ type: 'tool', at: 1, sessionID: 'ses_1', tool: { status: 'zumbi' } })
    })
    expect(invalid.status).toBe(400)
  })

  it('long-poll devolve a ação enfileirada e 204 quando a espera acaba', async () => {
    setup()
    const info = await bridge!.start()

    const pending = request({
      port: info.port,
      path: '/office/actions?wait=2000',
      method: 'GET',
      token: info.token
    })
    await delay(50)
    const id = enqueuedID(bridge!.enqueueAction(permissionAction()))

    const delivered = await pending
    expect(delivered.status).toBe(200)
    expect(delivered.body).toEqual({
      id,
      action: 'permission.reply',
      sessionID: 'ses_1',
      requestID: 'per_1',
      decision: 'once'
    })
    expect(bridge!.pendingActions()).toBe(1)

    const timeout = await request({
      port: info.port,
      path: '/office/actions?wait=20',
      method: 'GET',
      token: info.token
    })
    expect(timeout.status).toBe(204)
  })

  it('ação vencida (30 s) é descartada e nunca chega ao plugin', async () => {
    let clock = 10_000
    setup(() => clock)
    const info = await bridge!.start()

    enqueuedID(bridge!.enqueueAction(permissionAction()))
    expect(bridge!.pendingActions()).toBe(1)

    clock += ACTION_TTL_MS + 1
    const result = await request({
      port: info.port,
      path: '/office/actions?wait=0',
      method: 'GET',
      token: info.token
    })
    expect(result.status).toBe(204)
    expect(bridge!.pendingActions()).toBe(0)
  })

  it('mantém 1 ação em voo por sessão, sem furar a ordem FIFO', async () => {
    setup()
    const info = await bridge!.start()

    const firstID = enqueuedID(bridge!.enqueueAction(permissionAction('ses_1')))
    enqueuedID(bridge!.enqueueAction(permissionAction('ses_1')))
    const otherID = enqueuedID(bridge!.enqueueAction(permissionAction('ses_2')))

    const first = await request({
      port: info.port,
      path: '/office/actions?wait=0',
      method: 'GET',
      token: info.token
    })
    expect((first.body as { id: string }).id).toBe(firstID)

    // ses_1 já tem uma em voo: a próxima despachável é a de ses_2.
    const second = await request({
      port: info.port,
      path: '/office/actions?wait=0',
      method: 'GET',
      token: info.token
    })
    expect((second.body as { id: string }).id).toBe(otherID)

    const blocked = await request({
      port: info.port,
      path: '/office/actions?wait=0',
      method: 'GET',
      token: info.token
    })
    expect(blocked.status).toBe(204)

    // Resultado libera a sessão e a ação seguinte sai.
    await request({
      port: info.port,
      path: `/office/actions/${firstID}/result`,
      method: 'POST',
      token: info.token,
      body: JSON.stringify({ ok: true })
    })
    const third = await request({
      port: info.port,
      path: '/office/actions?wait=0',
      method: 'GET',
      token: info.token
    })
    expect(third.status).toBe(200)
    expect((third.body as { sessionID: string }).sessionID).toBe('ses_1')
  })

  it(`fila cheia recusa a ${ACTION_MAX_PENDING + 1}ª ação pendente`, async () => {
    setup()
    const info = await bridge!.start()

    for (let index = 0; index < ACTION_MAX_PENDING; index += 1) {
      enqueuedID(bridge!.enqueueAction(permissionAction(`ses_${index}`)))
    }
    expect(bridge!.pendingActions()).toBe(ACTION_MAX_PENDING)
    expect(bridge!.enqueueAction(permissionAction('ses_overflow'))).toEqual({
      ok: false,
      reason: 'fila-cheia'
    })

    // Sessão inválida também é recusada antes de entrar na fila.
    expect(bridge!.enqueueAction(permissionAction('sessao'))).toEqual({
      ok: false,
      reason: 'invalido'
    })

    await bridge!.stop()
    bridge = null
    expect(info.port).toBeGreaterThan(0)
  })

  it('resultado desconhecido responde 404 e token é obrigatório nos dois verbos', async () => {
    const { results } = setup()
    const info = await bridge!.start()

    const unknown = await request({
      port: info.port,
      path: '/office/actions/act_desconhecida/result',
      method: 'POST',
      token: info.token,
      body: JSON.stringify({ ok: true })
    })
    expect(unknown.status).toBe(404)

    const noToken = await request({
      port: info.port,
      path: '/office/actions?wait=0',
      method: 'GET'
    })
    expect(noToken.status).toBe(401)

    const noTokenResult = await request({
      port: info.port,
      path: '/office/actions/act_desconhecida/result',
      method: 'POST',
      body: JSON.stringify({ ok: true })
    })
    expect(noTokenResult.status).toBe(401)
    expect(results).toHaveLength(0)
  })

  it('resultado ok/erro limpa o voo e é emitido para o renderer', async () => {
    const { results } = setup()
    const info = await bridge!.start()

    const okID = enqueuedID(bridge!.enqueueAction(permissionAction('ses_1')))
    const failID = enqueuedID(
      bridge!.enqueueAction({
        action: 'session.prompt',
        sessionID: 'ses_2',
        text: 'revisar o diff'
      })
    )

    await request({
      port: info.port,
      path: '/office/actions?wait=0',
      method: 'GET',
      token: info.token
    })
    await request({
      port: info.port,
      path: '/office/actions?wait=0',
      method: 'GET',
      token: info.token
    })

    const okResult = await request({
      port: info.port,
      path: `/office/actions/${okID}/result`,
      method: 'POST',
      token: info.token,
      body: JSON.stringify({ ok: true })
    })
    expect(okResult.status).toBe(200)

    const failResult = await request({
      port: info.port,
      path: `/office/actions/${failID}/result`,
      method: 'POST',
      token: info.token,
      body: JSON.stringify({ ok: false, error: 'a permissão não existe mais' })
    })
    expect(failResult.status).toBe(200)

    expect(results).toEqual([
      {
        result: { id: okID, ok: true },
        action: 'permission.reply',
        sessionID: 'ses_1'
      },
      {
        result: { id: failID, ok: false, error: 'a permissão não existe mais' },
        action: 'session.prompt',
        sessionID: 'ses_2'
      }
    ])
    expect(bridge!.pendingActions()).toBe(0)

    // Repetir o resultado do mesmo id já não encontra a ação em voo.
    const repeated = await request({
      port: info.port,
      path: `/office/actions/${okID}/result`,
      method: 'POST',
      token: info.token,
      body: JSON.stringify({ ok: true })
    })
    expect(repeated.status).toBe(404)
  })
})
