import { describe, expect, it, vi } from 'vitest'
import { createToolRegistry } from '../gemini/tools/registry'
import type { ToolHandler } from '../gemini/tools/internal'
import { createActionLimiter } from '../audit/actions'
import { createActionToolEntries, registerActionTools, type ActionToolsEnv } from './tools'

/**
 * Integração das definições ao registro da task 05 (T10): schema válido,
 * categorias corretas e handlers que recusam antes de executar.
 */

function env(overrides: Partial<ActionToolsEnv> = {}): ActionToolsEnv {
  return {
    catalog: {
      load: async () => ({ apps: [], cached: false }),
      listNames: async () => ['Bloco de Notas'],
      open: vi.fn(async () => ({
        ok: false as const,
        reason: 'unknown' as const,
        error: 'fora do catálogo'
      })),
      registerAumid: async () => ({ ok: true })
    },
    processes: {
      list: async () => [],
      close: vi.fn(async () => ({
        ok: false as const,
        pid: 1,
        reason: 'not-found' as const,
        error: 'x'
      }))
    },
    search: async () => ({ results: [], truncated: false, timedOut: false, scannedDirectories: 0 }),
    readFile: async () => ({ path: '', text: '', truncated: false, bytes: 0, lines: 0 }),
    planFileOps: async () => ({ ops: [], totalBytes: 0, summary: '' }),
    applyFileOps: async () => ({ ok: true as const, id: 'x', ops: [], totalBytes: 0 }),
    undoFileOp: async () => ({ ok: true as const, id: 'x', undone: 0 }),
    system: {
      lock: async () => ({ ok: true as const }),
      sleep: async () => ({ ok: true as const }),
      shutdown: async () => ({ ok: true as const }),
      restart: async () => ({ ok: true as const }),
      cancelShutdown: async () => ({ ok: true as const }),
      setVolume: async () => ({ ok: true as const }),
      setBrightness: async () => ({ ok: true as const })
    },
    uia: {
      getUiTree: async () => ({ ok: true as const, nodes: [], partial: false, nodeCount: 0 }),
      invokeElement: vi.fn(async () => ({
        ok: false as const,
        code: 'failed' as const,
        error: 'não chamado'
      }))
    },
    limiter: createActionLimiter(),
    confirmForceClose: async () => false,
    confirmPlan: async () => false,
    ...overrides
  }
}

describe('ferramentas de ações', () => {
  it('registra todas as definições com categoria e sensibilidade corretas', () => {
    const registry = createToolRegistry()
    const handlers = new Map<string, ToolHandler>()

    const result = registerActionTools(registry, handlers, createActionToolEntries(env()))

    expect(result).toEqual({ ok: true, errors: [] })
    expect(registry.listTools().map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'open_app',
        'close_process',
        'search_files',
        'read_file',
        'apply_file_ops',
        'undo_file_op',
        'shutdown_computer',
        'get_ui_tree',
        'invoke_element'
      ])
    )
    expect(registry.getTool('open_app')).toMatchObject({
      category: 'apps.launch',
      sensitive: true
    })
    expect(registry.getTool('shutdown_computer')).toMatchObject({
      category: 'system.power',
      sensitive: true
    })
    expect(registry.getTool('get_ui_tree')).toMatchObject({
      category: 'uia.control',
      sensitive: true
    })
    expect(registry.getTool('read_file')).toMatchObject({
      category: 'files.read',
      sensitive: false
    })
  })

  it('open_app recusa nome fora do catálogo sem reportar sucesso', async () => {
    const entries = createActionToolEntries(env())
    const openApp = entries.find((entry) => entry.definition.name === 'open_app')
    if (!openApp) throw new Error('open_app ausente')

    await expect(openApp.handler({ name: 'Inexistente' })).rejects.toThrow(/fora do catálogo/)
  })

  it('invoke_element recusa papel inválido antes de chamar a UIA', async () => {
    const fake = env()
    const entries = createActionToolEntries(fake)
    const invoke = entries.find((entry) => entry.definition.name === 'invoke_element')
    if (!invoke) throw new Error('invoke_element ausente')

    await expect(invoke.handler({ name: 'Salvar', role: 'coordenada' })).rejects.toThrow(/role/)
    expect(fake.uia.invokeElement).not.toHaveBeenCalled()
  })
})
