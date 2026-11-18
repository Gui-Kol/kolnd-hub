import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  nextRetryDelayMs,
  normalizeEvent,
  parseOfficeAction,
  parsePluginEvent,
  pluginActionResult,
  shouldSnapshotPermissions,
  OFFICE_PLUGIN_SOURCE,
  OFFICE_PLUGIN_VERSION,
  PLUGIN_RETRY_FAST_MS,
  PLUGIN_RETRY_SLOW_MS
} from './pluginSource'

interface ActionLoopOptions {
  next: () => Promise<unknown>
  execute: (command: unknown) => Promise<void>
  report: (id: string, result: { ok: boolean; error?: string }) => Promise<void>
}

interface PluginModule {
  parseAction: (input: unknown) => unknown
  actionResult: (ok: boolean, error?: unknown) => unknown
  shouldSnapshotPermissions: (type: string) => boolean
  createActionLoop: (options: ActionLoopOptions) => () => Promise<boolean>
}

/** Escreve a string gerada e importa como ESM (mesmo caminho do plugin real). */
async function loadPluginSource(): Promise<{ dir: string; file: string; mod: PluginModule }> {
  const dir = mkdtempSync(join(tmpdir(), 'kolnd-office-plugin-actions-'))
  const file = join(dir, 'plugin.mjs')
  writeFileSync(file, OFFICE_PLUGIN_SOURCE, 'utf8')
  const mod = (await import(pathToFileURL(file).href)) as PluginModule
  return { dir, file, mod }
}

const CLOSED = { type: 'todo.updated', created: 1000, data: { sessionID: 'ses_1' } }

describe('normalizeEvent', () => {
  it('ferramenta em execução: shell running com comando curto', () => {
    const event = normalizeEvent({
      type: 'session.tool.called',
      created: 1234,
      location: { directory: 'C:\\repo\\alpha' },
      data: {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_1',
        id: 'call_1',
        name: 'shell',
        input: { command: 'npm run verify' }
      }
    })

    expect(event).toEqual({
      type: 'tool',
      at: 1234,
      sessionID: 'ses_1',
      tool: {
        name: 'shell',
        status: 'running',
        toolID: 'call_1',
        command: 'npm run verify'
      }
    })
  })

  it('ferramenta concluída e com erro', () => {
    const completed = normalizeEvent({
      type: 'session.tool.success',
      created: 2000,
      data: { sessionID: 'ses_1', id: 'call_1', content: [] }
    })
    expect(completed).toMatchObject({
      type: 'tool',
      at: 2000,
      sessionID: 'ses_1',
      tool: { status: 'completed', toolID: 'call_1' }
    })

    const failed = normalizeEvent({
      type: 'session.tool.failed',
      created: 2001,
      data: { sessionID: 'ses_1', id: 'call_2', error: {} }
    })
    expect(failed).toMatchObject({ type: 'tool', tool: { status: 'error', toolID: 'call_2' } })
  })

  it('edição de arquivo: só o basename, sem caminho completo', () => {
    const event = normalizeEvent({
      type: 'session.tool.input.started',
      created: 10,
      data: {
        sessionID: 'ses_1',
        id: 'call_edit',
        name: 'edit',
        input: { filePath: 'C:\\Users\\TiffoDi\\projeto\\src\\auth.ts' }
      }
    })

    expect(event?.type).toBe('tool')
    if (event?.type !== 'tool') return
    expect(event.tool.filePath).toBe('auth.ts')
    expect(JSON.stringify(event)).not.toContain('C:\\\\Users')
  })

  it('comando gigante é truncado em 60 e segredo é mascarado', () => {
    const command = `curl -H "Authorization: Bearer abcdefgh12345678" https://example.com ${'x'.repeat(300)}`
    const event = normalizeEvent({
      type: 'session.tool.called',
      created: 20,
      data: { sessionID: 'ses_1', id: 'call_2', name: 'shell', input: { command } }
    })

    expect(event?.type).toBe('tool')
    if (event?.type !== 'tool') return
    expect(event.tool.command?.length).toBeLessThanOrEqual(60)
    expect(event.tool.command?.endsWith('…')).toBe(true)
    expect(event.tool.command).not.toContain('abcdefgh12345678')
    expect(event.tool.command).toContain('***')
  })

  it('sessão renomeada vira atualização parcial', () => {
    const event = normalizeEvent({
      type: 'session.renamed',
      created: 30,
      location: { directory: 'C:\\repo\\alpha' },
      data: { sessionID: 'ses_9', title: 'Novo título' }
    })

    expect(event).toEqual({
      type: 'session',
      at: 30,
      session: {
        id: 'ses_9',
        title: 'Novo título',
        location: { directory: 'C:\\repo\\alpha' }
      }
    })
  })

  it('execução iniciada vira busy e session.idle vira idle', () => {
    expect(
      normalizeEvent({
        type: 'session.execution.started',
        created: 40,
        data: { sessionID: 'ses_1' }
      })
    ).toEqual({ type: 'status', at: 40, sessionID: 'ses_1', status: 'busy' })

    expect(
      normalizeEvent({ type: 'session.idle', created: 41, data: { sessionID: 'ses_1' } })
    ).toEqual({ type: 'status', at: 41, sessionID: 'ses_1', status: 'idle' })
  })

  it('permissão pedida: ação e recursos mascarados/truncados', () => {
    const resource = `C:\\repo\\arquivo-${'a'.repeat(260)}.ts`
    const event = normalizeEvent({
      type: 'permission.asked',
      created: 50,
      data: {
        sessionID: 'ses_1',
        id: 'per_1',
        action: 'bash',
        resources: [resource],
        save: ['bash']
      }
    })

    expect(event?.type).toBe('permission')
    if (event?.type !== 'permission') return
    expect(event.request.id).toBe('per_1')
    expect(event.request.action).toBe('bash')
    expect(event.request.resources.length).toBeLessThanOrEqual(200)
    expect(event.request.resources.endsWith('…')).toBe(true)
    expect(event.request.save).toEqual(['bash'])
  })

  it('permissão respondida remove o pedido da sessão', () => {
    expect(
      normalizeEvent({
        type: 'permission.replied',
        created: 60,
        data: { sessionID: 'ses_1', requestID: 'per_1', reply: 'once' }
      })
    ).toEqual({ type: 'permission-replied', at: 60, sessionID: 'ses_1', requestID: 'per_1' })
  })

  it('evento desconhecido ou malformado devolve null', () => {
    expect(normalizeEvent(CLOSED)).toBeNull()
    expect(normalizeEvent({ type: 'session.idle', created: 1, data: {} })).toBeNull()
    expect(normalizeEvent(null)).toBeNull()
    expect(normalizeEvent({ created: 1 })).toBeNull()
  })
})

describe('parsePluginEvent (entrada da ponte)', () => {
  it('aceita evento normalizado e rejeita fora do contrato', () => {
    expect(
      parsePluginEvent({
        type: 'status',
        at: 1,
        sessionID: 'ses_1',
        status: 'busy'
      })
    ).toEqual({ type: 'status', at: 1, sessionID: 'ses_1', status: 'busy' })

    expect(
      parsePluginEvent({ type: 'status', at: 1, sessionID: 'ses_1', status: 'zumbi' })
    ).toBeNull()
    expect(parsePluginEvent({ type: 'nope', at: 1 })).toBeNull()
    expect(parsePluginEvent({ type: 'tool', at: 1, sessionID: 'ses_1', tool: null })).toBeNull()
  })

  it('aceita snapshot de sessões e corta o excedente em 50', () => {
    const sessions = Array.from({ length: 80 }, (_, index) => ({
      id: `ses_${index}`,
      title: `Sessão ${index}`
    }))
    const parsed = parsePluginEvent({ type: 'sessions', at: 1, sessions })
    expect(parsed?.type).toBe('sessions')
    if (parsed?.type !== 'sessions') return
    expect(parsed.sessions).toHaveLength(50)
    expect(parsed.sessions[0]).toEqual({ id: 'ses_0', title: 'Sessão 0' })
  })
})

describe('nextRetryDelayMs', () => {
  it('usa 5 s nas 3 primeiras tentativas e 30 s da 4ª em diante, sem desistir', () => {
    expect(PLUGIN_RETRY_FAST_MS).toBe(5000)
    expect(PLUGIN_RETRY_SLOW_MS).toBe(30_000)
    expect([1, 2, 3].map(nextRetryDelayMs)).toEqual([5000, 5000, 5000])
    expect([4, 5, 100, 1_000_000].map(nextRetryDelayMs)).toEqual([30_000, 30_000, 30_000, 30_000])
    // Entrada inválida nunca vira timer negativo/NaN.
    expect(nextRetryDelayMs(0)).toBe(5000)
    expect(nextRetryDelayMs(Number.NaN)).toBe(5000)
  })
})

describe('OFFICE_PLUGIN_SOURCE', () => {
  it('é autocontido, exporta a versão e não importa pacotes externos', () => {
    expect(OFFICE_PLUGIN_SOURCE).toContain(`export const version = '${OFFICE_PLUGIN_VERSION}'`)
    expect(OFFICE_PLUGIN_SOURCE).toContain("id: 'kolnd.office'")
    expect(OFFICE_PLUGIN_SOURCE).not.toContain('@opencode/plugin')
    expect(OFFICE_PLUGIN_SOURCE).toContain("from 'node:fs'")
    expect(OFFICE_PLUGIN_SOURCE).toContain('/office/events')
    expect(OFFICE_PLUGIN_SOURCE).toContain('nextRetryDelayMs')
    expect(OFFICE_PLUGIN_SOURCE).not.toContain('RETRY_MAX')
  })

  it('normalizador embutido concorda com a versão tipada', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kolnd-office-plugin-'))
    try {
      const file = join(dir, 'plugin.mjs')
      writeFileSync(file, OFFICE_PLUGIN_SOURCE, 'utf8')
      const mod = (await import(pathToFileURL(file).href)) as {
        normalizeEvent: (event: unknown) => unknown
        nextRetryDelayMs: (attempt: number) => number
      }
      const event = {
        type: 'session.tool.called',
        created: 777,
        data: {
          sessionID: 'ses_1',
          id: 'call_1',
          name: 'shell',
          input: { command: 'npm test' }
        }
      }
      expect(mod.normalizeEvent(event)).toEqual(normalizeEvent(event))
      expect([1, 3, 4, 99].map(mod.nextRetryDelayMs)).toEqual([5000, 5000, 30_000, 30_000])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('o parser embutido concorda com o tipado (ação válida e recusas)', async () => {
    const { dir, mod } = await loadPluginSource()
    try {
      const permission = {
        id: 'act_1',
        action: 'permission.reply',
        sessionID: 'ses_1',
        requestID: 'per_1',
        decision: 'always',
        message: 'pode seguir'
      }
      expect(mod.parseAction(permission)).toEqual(parseOfficeAction(permission))

      const prompt = {
        id: 'act_2',
        action: 'session.prompt',
        sessionID: 'ses_1',
        text: 'revisar o diff',
        delivery: 'queue'
      }
      expect(mod.parseAction(prompt)).toEqual(parseOfficeAction(prompt))

      // sessão fora do formato ses_ e texto acima de 2000 são recusados pelos dois.
      for (const invalid of [
        { ...permission, sessionID: 'outra' },
        { ...prompt, text: 'x'.repeat(2001) },
        { ...prompt, action: 'session.remove' },
        { ...prompt, id: '' }
      ]) {
        expect(mod.parseAction(invalid)).toBeNull()
        expect(parseOfficeAction(invalid)).toBeNull()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resultado ok/erro é curto e concorda com o tipo do Hub', async () => {
    const { dir, mod } = await loadPluginSource()
    try {
      expect(mod.actionResult(true)).toEqual(pluginActionResult(true))
      expect(mod.actionResult(false, 'a ação falhou no OpenCode')).toEqual(
        pluginActionResult(false, 'a ação falhou no OpenCode')
      )
      const failed = mod.actionResult(false) as { ok: boolean; error: string }
      expect(failed).toEqual({ ok: false, error: 'a ação falhou' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('executa uma ação por vez e responde o desfecho de cada uma', async () => {
    const { dir, mod } = await loadPluginSource()
    try {
      const holder: { release?: () => void } = {}
      const executed: string[] = []
      const reported: Array<{ id: string; ok: boolean }> = []
      let nextCalls = 0

      const loop = mod.createActionLoop({
        next: async () => {
          nextCalls += 1
          return { id: 'act_1', action: 'session.prompt', sessionID: 'ses_1', text: 'oi' }
        },
        execute: async (command) => {
          executed.push((command as { id: string }).id)
          await new Promise<void>((resolve) => {
            holder.release = resolve
          })
        },
        report: async (id, result) => {
          reported.push({ id, ok: result.ok })
        }
      })

      const first = loop()
      expect(await loop()).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(executed).toEqual(['act_1'])
      expect(nextCalls).toBe(1)

      holder.release?.()
      await first
      expect(reported).toEqual([{ id: 'act_1', ok: true }])
      expect(nextCalls).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falha de execução vira resultado ok:false sem derrubar o laço', async () => {
    const { dir, mod } = await loadPluginSource()
    try {
      const reported: Array<{ id: string; ok: boolean; error?: string }> = []
      const loop = mod.createActionLoop({
        next: async () => ({
          id: 'act_9',
          action: 'permission.reply',
          sessionID: 'ses_1',
          requestID: 'per_1',
          decision: 'reject'
        }),
        execute: async () => {
          throw new Error('OpenCode recusou')
        },
        report: async (id, result) => {
          reported.push({ id, ...result })
        }
      })

      await loop()
      expect(reported).toHaveLength(1)
      expect(reported[0]).toMatchObject({ id: 'act_9', ok: false })
      expect(reported[0].error).toBeTruthy()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('permission.asked/replied disparam snapshot imediato nos dois lados', async () => {
    expect(shouldSnapshotPermissions('permission')).toBe(true)
    expect(shouldSnapshotPermissions('permission-replied')).toBe(true)
    expect(shouldSnapshotPermissions('tool')).toBe(false)
    expect(OFFICE_PLUGIN_SOURCE).toContain('shouldSnapshotPermissions(normalized.type)')
    expect(OFFICE_PLUGIN_SOURCE).toContain('void sendPermissions(normalized.sessionID)')
  })

  it('a fonte gerada só importa node:fs/node:path e passa no node --check', async () => {
    const imports = OFFICE_PLUGIN_SOURCE.split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('import '))
    expect(imports).toEqual([
      "import { readFileSync } from 'node:fs'",
      "import { join } from 'node:path'"
    ])
    expect(OFFICE_PLUGIN_SOURCE).toContain('/office/actions?wait=')
    expect(OFFICE_PLUGIN_SOURCE).toContain('/result')

    const { dir, file } = await loadPluginSource()
    try {
      expect(() =>
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
      ).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
