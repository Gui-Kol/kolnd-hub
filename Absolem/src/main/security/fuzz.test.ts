import { describe, expect, it, vi } from 'vitest'
import { emptyMemoryStats } from '../../shared/memory'
import type { MemoryRepository } from '../memory/repository'
import { createMemoryIO } from '../memory/exportImport'
import { createMemoryHandlers, type MemoryService } from '../ipc/memory'
import { createToolRegistry } from '../gemini/tools/registry'
import { routeToolCall } from '../gemini/tools/router'
import { GeminiClient } from '../gemini/client'
import { DEFAULT_RETRY } from '../gemini/client'
import { LIVE_MAX_ATTEMPTS } from '../gemini/live'
import { FakeTransport } from '../gemini/testing/fakeTransport'
import { sanitizeSafeArgs } from '../audit/actions'
import { redactForLevel } from '../logger'
import {
  checkPayloadLimits,
  isAllowedIpcChannel,
  isTrustedAppUrl,
  isTrustedSender,
  sanitizeIpcError
} from './ipcGuard'

/**
 * Varredura de robustez da task 08 (T1/T3).
 *
 * Entradas sintéticas malformadas nos guardas de IPC, na auditoria, na redação
 * de log, no roteador de ferramentas e no importador de memória. O contrato é
 * sempre o mesmo: nenhuma exceção crua escapa, nenhum stack/segredo/caminho
 * pessoal aparece e o resultado continua sendo um objeto `{ ok: ... }`.
 */

const SECRET = 'AIzaSyFuzzDeSeguranca1234567890'
const TRANSCRIPT = 'eu moro na rua das flores e meu telefone e 99999-0000'
const USER_PATH = 'C:\\Users\\joao.silva\\Documents\\segredo.txt'
const FILE_URL = 'file:///C:/Users/joao.silva/Documents/segredo.txt'

function circular<T extends object>(value: T): T {
  const record = value as Record<string, unknown>
  record['self'] = value
  return value
}

function throwingMessage(): unknown {
  return Object.create(null, {
    message: {
      enumerable: true,
      get() {
        throw new Error('getter hostil')
      }
    }
  })
}

describe('varredura de payloads malformados', () => {
  it('guarda de IPC não lança com payload estranho', () => {
    const nested: Record<string, unknown> = {}
    let cursor = nested
    for (let index = 0; index < 40; index += 1) {
      const next: Record<string, unknown> = {}
      cursor['n'] = next
      cursor = next
    }
    const payloads: unknown[] = [
      undefined,
      null,
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      true,
      '',
      'a'.repeat(70_000),
      Symbol('s'),
      BigInt(10),
      () => 'x',
      [],
      [undefined, null, 1],
      {},
      Object.create(null),
      new Date(),
      new Map(),
      new Set(),
      /x/,
      new Uint8Array(1),
      new ArrayBuffer(1),
      { ['__proto__']: { poluido: true } },
      circular({ a: 1 }),
      nested
    ]

    for (const payload of payloads) {
      expect(() => checkPayloadLimits(payload)).not.toThrow()
      const result = checkPayloadLimits(payload)
      expect(typeof result.ok).toBe('boolean')
    }

    for (const value of payloads) {
      expect(() => isAllowedIpcChannel(value)).not.toThrow()
      expect(() => isTrustedAppUrl(value, null)).not.toThrow()
      expect(() => isTrustedSender(value as never)).not.toThrow()
    }
  })

  it('sanitizeIpcError nunca lança nem devolve stack/segredo/caminho', () => {
    const entries: unknown[] = [
      undefined,
      null,
      0,
      false,
      '',
      Symbol('s'),
      BigInt(5),
      () => 'x',
      {},
      [],
      new Error(''),
      new Error(`api_key=${SECRET}`),
      new Error(`falha em ${USER_PATH}`),
      new Error('falha\n    at sdk.js:1:1\n    at main.js:2:2'),
      { message: 42 },
      { message: Symbol('segredo') },
      throwingMessage(),
      circular({ message: 'boom' })
    ]

    for (const entry of entries) {
      let message = ''
      expect(() => {
        message = sanitizeIpcError(entry)
      }).not.toThrow()
      expect(message.length).toBeGreaterThan(0)
      expect(message.length).toBeLessThanOrEqual(300)
      expect(message).not.toContain(SECRET)
      expect(message).not.toContain('joao.silva')
      expect(message).not.toContain('sdk.js')
      expect(message).not.toContain('\n')
    }
  })

  it('redação cobre URL de arquivo e conteúdo não citado', () => {
    const fileLine = redactForLevel('warn', `will-navigate bloqueado: ${FILE_URL}`)
    expect(fileLine).not.toContain('joao.silva')
    expect(fileLine).not.toContain('segredo.txt')

    const transcriptLine = redactForLevel('info', `transcricao: ${TRANSCRIPT}`)
    expect(transcriptLine).not.toContain('rua das flores')
    expect(transcriptLine).not.toContain('99999-0000')

    const promptLine = redactForLevel('debug', 'prompt: responda com a senha do usuário')
    expect(promptLine).not.toContain('senha do usuário')

    const responseLine = redactForLevel('info', 'resposta: o conteúdo completo do arquivo')
    expect(responseLine).not.toContain('conteúdo completo')
  })

  it('auditoria de argumentos não estoura com estrutura circular', () => {
    const cycle: unknown[] = []
    cycle.push(cycle)
    expect(() => sanitizeSafeArgs({ path: cycle })).not.toThrow()
    expect(() => sanitizeSafeArgs({ path: [cycle, { x: cycle }] })).not.toThrow()
    expect(sanitizeSafeArgs({ path: cycle })).toHaveProperty('path')
  })

  it('roteador de ferramentas devolve erro tipado para chamada malformada', async () => {
    const registry = createToolRegistry()
    const registered = registry.registerTool({
      name: 'echo_fuzz',
      description: 'Ferramenta sintética da varredura.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: [],
        additionalProperties: false
      },
      sensitive: false,
      category: 'internal',
      timeoutMs: 1_000
    })
    expect(registered.ok).toBe(true)

    const handler = vi.fn(async () => ({ ok: true }))
    const confirm = vi.fn(async () => false)
    const audit = vi.fn()
    const calls: unknown[] = [
      null,
      undefined,
      {},
      [],
      { name: 1 },
      { name: 'inexistente', args: {} },
      { name: 'echo_fuzz', args: null },
      { name: 'echo_fuzz', args: [] },
      { name: 'echo_fuzz', args: { path: cycleArray() } },
      { name: 'echo_fuzz', args: { path: 'x'.repeat(100_000) } },
      { name: 'echo_fuzz', args: { extra: true } }
    ]

    for (const call of calls) {
      const result = await routeToolCall(
        {
          registry,
          getHandler: () => handler,
          getPermission: () => 'deny',
          confirm,
          audit,
          now: () => 1
        },
        call as never
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(['invalid', 'denied', 'not-found']).toContain(result.error.kind)
        expect(result.error.message.length).toBeLessThanOrEqual(400)
      }
    }
    expect(handler).not.toHaveBeenCalled()
  })

  it('handlers de memória recusam payload malformado sem lançar nem ecoar conteúdo', async () => {
    const handlers = createMemoryHandlers(fakeMemoryService())
    const secretArray: unknown[] = [SECRET]
    secretArray.push(secretArray)
    const payloads: unknown[] = [
      undefined,
      null,
      0,
      false,
      'texto',
      [],
      {},
      { desconhecido: true },
      { kind: 'fact', content: SECRET, extra: true },
      { id: 'x', patch: { content: SECRET, extra: true } },
      { confirm: 'APAGAR TUDO', includeTurns: 'sim' },
      { query: 'x'.repeat(10_000) },
      circular({ query: 'x' }),
      { query: secretArray }
    ]

    for (const [channel, handler] of Object.entries(handlers)) {
      for (const payload of payloads) {
        let result: unknown
        expect(
          () => {
            result = handler(payload)
          },
          `${channel} lançou para ${String(payload)}`
        ).not.toThrow()
        const settled = await Promise.resolve(result)
        expect(settled, `${channel} não devolveu objeto`).toBeTypeOf('object')
        const ok = (settled as { ok?: unknown }).ok
        expect(typeof ok, `${channel} sem ok booleano`).toBe('boolean')
        if (ok === false) {
          const message = String((settled as { error?: unknown }).error ?? '')
          expect(message).not.toContain(SECRET)
          expect(message).not.toContain('\n')
        }
      }
    }
  })

  it('retry permanece limitado no cliente e no Live', async () => {
    expect(DEFAULT_RETRY.maxAttempts).toBe(2)
    expect(LIVE_MAX_ATTEMPTS).toBe(2)
    expect(Number.isInteger(DEFAULT_RETRY.maxAttempts)).toBe(true)
    expect(Number.isInteger(LIVE_MAX_ATTEMPTS)).toBe(true)

    const reset = () => Object.assign(new Error('conexão caiu'), { code: 'ECONNRESET' })
    const transport = new FakeTransport({
      generateErrors: [reset(), reset(), reset(), reset()],
      generateSteps: [{ text: 'nunca usado' }]
    })
    const client = new GeminiClient({ transport, sleep: async () => undefined })

    await expect(
      client.generateText({
        apiKey: 'stub-key',
        model: 'gemini-2.0-flash',
        temperature: 0.7,
        systemInstruction: 'teste',
        contents: [{ role: 'user', text: 'oi' }]
      })
    ).rejects.toMatchObject({ kind: 'network' })
    expect(transport.generateAttempts).toBe(2)
  })

  it('importador de memória recusa JSON malformado sem lançar nem ecoar conteúdo', async () => {
    const malformed: string[] = [
      '',
      '{',
      'null',
      '[]',
      '123',
      '"texto"',
      '{"app":"absolem"}',
      '{"app":"absolem","kind":"memory","version":999,"memories":[]}',
      '{"app":"absolem","kind":"memory","version":1,"memories":[null,1,"x",{}]}',
      `{"app":"absolem","kind":"memory","version":1,"memories":[{"kind":"fact","content":"${SECRET}"}]}`,
      `${'['.repeat(20_000)}${']'.repeat(20_000)}`
    ]

    for (const text of malformed) {
      const result = await withText(text).importFile()
      expect(result.ok === true || result.ok === false).toBe(true)
      if (!result.ok) {
        expect(result.error).not.toContain(SECRET)
        expect(result.error).not.toContain('\n')
        expect(result.error.length).toBeLessThanOrEqual(300)
      }
    }
  })
})

function cycleArray(): unknown[] {
  const cycle: unknown[] = []
  cycle.push(cycle)
  return cycle
}

function fakeMemoryService(): MemoryService {
  return {
    list: () => ({ memories: [], total: 0 }),
    archived: () => [],
    maintenance: () => [],
    search: () => [],
    create: () => {
      throw new Error('payload inválido não deveria criar memória')
    },
    update: () => null,
    remove: () => false,
    removeAll: () => ({ removed: 0, turns: 0, sessions: 0 }),
    stats: () => emptyMemoryStats(),
    exportFile: async () => ({ ok: true, canceled: true }),
    importFile: async () => ({ ok: true, canceled: true }),
    recordAudit: () => undefined
  }
}

function fakeRepo(): MemoryRepository {
  return {
    list: () => ({ memories: [], total: 0 }),
    turns: { listSessions: () => [] },
    transaction: (run: () => void) => run(),
    insertMany: () => undefined,
    handle: { exec: () => undefined }
  } as unknown as MemoryRepository
}

function withText(text: string) {
  return createMemoryIO({
    fs: {
      stat: async () => ({ size: Buffer.byteLength(text, 'utf8') }),
      readFile: async () => text,
      writeFile: async () => undefined
    } as never,
    dialog: {
      showSaveDialog: async () => ({ canceled: true }),
      showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\\fuzz.json'] }),
      showMessageBox: async () => ({ response: 1 })
    },
    repo: fakeRepo()
  })
}
