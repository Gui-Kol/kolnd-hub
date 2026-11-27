import { describe, expect, it, vi } from 'vitest'
import { createToolRegistry } from '../gemini/tools/registry'
import type { ToolHandler } from '../gemini/tools/internal'
import { createActionLimiter } from '../audit/actions'
import { parseAllowedExternalUrl } from '../../shared/search'
import { youtubeSearchQueryFromUrl } from '../youtube/search'
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
    openUrl: async (url) => {
      const allowed = parseAllowedExternalUrl(url)
      if (!allowed) throw new Error('Apenas links http ou https podem ser abertos.')
      return { url: allowed }
    },
    openYoutube: async () => ({
      url: 'https://www.youtube.com/watch?v=oDVH4HnGByU',
      title: 'Episódio 400',
      videoId: 'oDVH4HnGByU'
    }),
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
        'invoke_element',
        'open_youtube'
      ])
    )
    expect(registry.getTool('open_app')).toMatchObject({
      category: 'apps.launch',
      sensitive: true,
      timeoutMs: 20_000
    })
    expect(registry.getTool('open_app')?.description).toContain('espera')
    expect(registry.getTool('open_app')?.description).toContain('confirmar que ele abriu')
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
    expect(registry.getTool('open_url')).toMatchObject({
      category: 'web.search',
      sensitive: false
    })
    expect(registry.getTool('open_youtube')).toMatchObject({
      category: 'web.search',
      sensitive: false,
      timeoutMs: 20_000
    })
  })

  it('open_url abre http/https e recusa o resto antes do navegador', async () => {
    const openUrl = vi.fn(async (url: string) => ({ url }))
    const entries = createActionToolEntries(env({ openUrl }))
    const openUrlEntry = entries.find((entry) => entry.definition.name === 'open_url')
    if (!openUrlEntry) throw new Error('open_url ausente')

    await expect(
      openUrlEntry.handler({ url: 'https://www.youtube.com/results?search_query=absolem' })
    ).resolves.toEqual({
      url: 'https://www.youtube.com/results?search_query=absolem',
      message: 'Abri o site www.youtube.com no navegador.'
    })
    expect(openUrl).toHaveBeenCalledTimes(1)

    // Sem override: a allowlist compartilhada recusa antes de qualquer abertura.
    const rejecting = createActionToolEntries(env())
    const rejectingEntry = rejecting.find((entry) => entry.definition.name === 'open_url')
    if (!rejectingEntry) throw new Error('open_url ausente')

    await expect(rejectingEntry.handler({ url: 'javascript:alert(1)' })).rejects.toThrow(
      /^Não consegui abrir o site: .*http ou https/
    )
    await expect(
      rejectingEntry.handler({ url: 'file:///C:/Windows/System32/calc.exe' })
    ).rejects.toThrow(/http ou https/)
  })

  it('open_youtube pesquisa e devolve apenas o vídeo direto (watch?v=)', async () => {
    const openYoutube = vi.fn(async (_query: string) => ({
      url: 'https://www.youtube.com/watch?v=oDVH4HnGByU',
      title: 'Episódio 400 da casa automática',
      videoId: 'oDVH4HnGByU'
    }))
    const entries = createActionToolEntries(env({ openYoutube }))
    const entry = entries.find((item) => item.definition.name === 'open_youtube')
    if (!entry) throw new Error('open_youtube ausente')

    const result = (await entry.handler({ query: '  casa automatica episodio 400  ' })) as {
      url: string
      title: string
      videoId: string
    }

    expect(openYoutube).toHaveBeenCalledWith('casa automatica episodio 400')
    expect(result).toEqual({
      url: 'https://www.youtube.com/watch?v=oDVH4HnGByU',
      title: 'Episódio 400 da casa automática',
      videoId: 'oDVH4HnGByU',
      message: 'Abri o vídeo "Episódio 400 da casa automática" no navegador.'
    })
    expect(result.url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=/)
    expect(result.url).not.toContain('/results')
  })

  it('open_url de resultados do YouTube é desviado para o vídeo direto', async () => {
    const openYoutube = vi.fn(async (_query: string) => ({
      url: 'https://www.youtube.com/watch?v=oDVH4HnGByU',
      title: 'Episódio 400',
      videoId: 'oDVH4HnGByU'
    }))
    // Mesma composição do openUrl de instance.ts: reconhece a busca e desvia
    // para openYoutube em vez de abrir a página de resultados.
    const openUrl = vi.fn(async (url: string) => {
      const allowed = parseAllowedExternalUrl(url)
      if (!allowed) throw new Error('Apenas links http ou https podem ser abertos.')
      const query = youtubeSearchQueryFromUrl(allowed)
      if (query) return { url: (await openYoutube(query)).url }
      return { url: allowed }
    })
    const entries = createActionToolEntries(env({ openUrl, openYoutube }))
    const entry = entries.find((item) => item.definition.name === 'open_url')
    if (!entry) throw new Error('open_url ausente')

    const resultsUrl = 'https://www.youtube.com/results?search_query=casa+automatica+episodio+400'
    await expect(entry.handler({ url: resultsUrl })).resolves.toEqual({
      url: 'https://www.youtube.com/watch?v=oDVH4HnGByU',
      message: 'Abri o site www.youtube.com no navegador.'
    })
    expect(openYoutube).toHaveBeenCalledWith('casa automatica episodio 400')
    expect(openUrl.mock.calls[0]?.[0]).toBe(resultsUrl)

    // URL comum continua abrindo direto, sem passar pelo resolvedor.
    openYoutube.mockClear()
    await expect(entry.handler({ url: 'https://example.com/artigo' })).resolves.toEqual({
      url: 'https://example.com/artigo',
      message: 'Abri o site example.com no navegador.'
    })
    expect(openYoutube).not.toHaveBeenCalled()
  })

  it('open_youtube recusa query vazia e propaga erro sem resultado', async () => {
    const openYoutube = vi.fn(async () => ({
      url: 'https://www.youtube.com/watch?v=oDVH4HnGByU',
      title: 'x',
      videoId: 'oDVH4HnGByU'
    }))
    const entries = createActionToolEntries(env({ openYoutube }))
    const entry = entries.find((item) => item.definition.name === 'open_youtube')
    if (!entry) throw new Error('open_youtube ausente')

    await expect(entry.handler({ query: '   ' })).rejects.toThrow(/1 a 200/)
    await expect(entry.handler({ query: 'x'.repeat(201) })).rejects.toThrow(/1 a 200/)
    expect(openYoutube).not.toHaveBeenCalled()

    const failing = createActionToolEntries(
      env({
        openYoutube: async () => {
          throw new Error('Nenhum vídeo encontrado no YouTube para "xyz".')
        }
      })
    )
    const failingEntry = failing.find((item) => item.definition.name === 'open_youtube')
    if (!failingEntry) throw new Error('open_youtube ausente')

    await expect(failingEntry.handler({ query: 'xyz' })).rejects.toThrow(/Nenhum vídeo/)
  })

  it('open_app recusa nome fora do catálogo sem reportar sucesso', async () => {
    const entries = createActionToolEntries(env())
    const openApp = entries.find((entry) => entry.definition.name === 'open_app')
    if (!openApp) throw new Error('open_app ausente')

    await expect(openApp.handler({ name: 'Inexistente' })).rejects.toThrow(/fora do catálogo/)
  })

  it('open_app repassa a frase pronta e a flag de app já aberto', async () => {
    const base = env()
    const open = vi.fn(async (_name: string) => ({
      ok: true as const,
      app: { name: 'Insomnia', kind: 'known' as const, target: 'C:\\Apps\\Insomnia.exe' },
      pid: 4321,
      verified: true,
      alreadyRunning: true as const,
      message: 'O aplicativo Insomnia já estava aberto.'
    }))
    const entries = createActionToolEntries(env({ catalog: { ...base.catalog, open } }))
    const entry = entries.find((item) => item.definition.name === 'open_app')
    if (!entry) throw new Error('open_app ausente')

    await expect(entry.handler({ name: 'Insomnia' })).resolves.toEqual({
      app: 'Insomnia',
      pid: 4321,
      verified: true,
      message: 'O aplicativo Insomnia já estava aberto.',
      alreadyRunning: true
    })
    expect(open).toHaveBeenCalledWith('Insomnia')
  })

  it('close_process devolve a frase com o nome do processo fechado', async () => {
    const processes = {
      list: vi.fn(async () => [
        { name: 'Insomnia.exe', pid: 50, sessionName: 'Console', memKB: 900 }
      ]),
      close: vi.fn(async () => ({ ok: true as const, pid: 50, forced: false }))
    }
    const entries = createActionToolEntries(env({ processes }))
    const entry = entries.find((item) => item.definition.name === 'close_process')
    if (!entry) throw new Error('close_process ausente')

    await expect(entry.handler({ pid: 50 })).resolves.toEqual({
      ok: true,
      pid: 50,
      forced: false,
      message: 'Fechei o Insomnia.exe.'
    })
  })

  it('close_process em falha devolve frase amigável', async () => {
    const processes = {
      list: vi.fn(async () => [
        { name: 'Insomnia.exe', pid: 50, sessionName: 'Console', memKB: 900 }
      ]),
      close: vi.fn(async () => ({
        ok: false as const,
        pid: 50,
        reason: 'failed' as const,
        error: 'acesso negado',
        canForce: true
      }))
    }
    const entries = createActionToolEntries(env({ processes }))
    const entry = entries.find((item) => item.definition.name === 'close_process')
    if (!entry) throw new Error('close_process ausente')

    await expect(entry.handler({ pid: 50 })).rejects.toThrow(
      /^Não consegui fechar Insomnia\.exe: acesso negado/
    )
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
