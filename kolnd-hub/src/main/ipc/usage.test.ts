import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showSaveDialog: vi.fn(),
  writeFileSync: vi.fn(),
  readUsageEvents: vi.fn((): unknown[] => []),
  summarizeUsage: vi.fn(() => ({
    totalSessions: 1,
    totalSeconds: 120,
    byDay: [],
    topApps: [],
    topGames: [],
    pageViews: { dashboard: 1, settings: 0, inicializacao: 0, biblioteca: 0 }
  })),
  usageToCsv: vi.fn(() => 'csv,gerado'),
  clearUsageFiles: vi.fn((): { success: boolean; removed: number; error?: string } => ({
    success: true,
    removed: 2
  })),
  appendUsageEvent: vi.fn(() => true),
  buildUsageEvent: vi.fn((type: string, input: Record<string, unknown> = {}) => ({
    ts: '2026-11-25T10:00:00.000Z',
    type,
    ...input
  })),
  logInfo: vi.fn(),
  logError: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: { showSaveDialog: mocks.showSaveDialog },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('fs', () => ({ writeFileSync: mocks.writeFileSync }))
vi.mock('../usageLog', () => ({
  readUsageEvents: mocks.readUsageEvents,
  summarizeUsage: mocks.summarizeUsage,
  usageToCsv: mocks.usageToCsv,
  clearUsageFiles: mocks.clearUsageFiles,
  appendUsageEvent: mocks.appendUsageEvent,
  buildUsageEvent: mocks.buildUsageEvent,
  USAGE_READ_MAX_LIMIT: 10_000
}))
vi.mock('../logger', () => ({
  logger: { info: mocks.logInfo, warn: vi.fn(), error: mocks.logError, debug: vi.fn() }
}))

import { registerUsageIpc } from './usage'
import type { IpcContext } from './lifecycle'

const win = { id: 1 }
let mainWindow: typeof win | null = win
const ctx = { getMainWindow: () => mainWindow } as unknown as IpcContext

function call(channel: string, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Handler ausente: ${channel}`)
  return handler({}, ...args)
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  mainWindow = win
  mocks.readUsageEvents.mockReturnValue([])
  mocks.clearUsageFiles.mockReturnValue({ success: true, removed: 2 })
  registerUsageIpc(ctx)
})

describe('usage:read', () => {
  it('devolve os eventos e repassa só filtros válidos', () => {
    const events = [{ ts: '2026-11-25T10:00:00.000Z', type: 'page-view', page: 'dashboard' }]
    mocks.readUsageEvents.mockReturnValue(events)

    expect(
      call('usage:read', {
        from: '2026-11-01',
        to: '2026-11-25',
        type: 'page-view',
        page: 'dashboard',
        limit: 50
      })
    ).toEqual({ ok: true, events })
    expect(mocks.readUsageEvents).toHaveBeenCalledWith({
      from: '2026-11-01',
      to: '2026-11-25',
      type: 'page-view',
      page: 'dashboard',
      limit: 50
    })
  })

  it('descarta filtros fora da whitelist', () => {
    call('usage:read', {
      from: 'ontem',
      to: 123,
      type: 'tipo-invalido',
      page: 'hack',
      limit: '10'
    })
    expect(mocks.readUsageEvents).toHaveBeenCalledWith({})
  })

  it('payload que não é objeto vira filtro vazio', () => {
    call('usage:read', 'lixo')
    expect(mocks.readUsageEvents).toHaveBeenCalledWith({})
  })

  it('falha na leitura vira ok=false com a mensagem', () => {
    mocks.readUsageEvents.mockImplementationOnce(() => {
      throw new Error('disco')
    })
    expect(call('usage:read')).toEqual({ ok: false, events: [], error: 'disco' })
    expect(mocks.logError).toHaveBeenCalled()
  })
})

describe('usage:summary', () => {
  it('resume os eventos filtrados', () => {
    const result = call('usage:summary', { type: 'page-view' }) as {
      ok: boolean
      summary: { totalSessions: number }
    }
    expect(result.ok).toBe(true)
    expect(result.summary.totalSessions).toBe(1)
    expect(mocks.readUsageEvents).toHaveBeenCalledWith({ type: 'page-view' })
    expect(mocks.summarizeUsage).toHaveBeenCalled()
  })

  it('falha vira resumo vazio com a mensagem', () => {
    mocks.readUsageEvents.mockImplementationOnce(() => {
      throw new Error('quebrou')
    })
    expect(call('usage:summary')).toEqual({
      ok: false,
      summary: {
        totalSessions: 0,
        totalSeconds: 0,
        byDay: [],
        topApps: [],
        topGames: [],
        pageViews: { dashboard: 0, settings: 0, inicializacao: 0, biblioteca: 0 }
      },
      error: 'quebrou'
    })
  })
})

describe('usage:export', () => {
  it('exporta JSON no caminho escolhido (com janela principal)', async () => {
    mocks.readUsageEvents.mockReturnValue([
      { ts: '2026-11-25T10:00:00.000Z', type: 'page-view', page: 'dashboard' }
    ])
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\out\\uso.json' })

    await expect(call('usage:export', { format: 'json' })).resolves.toEqual({
      success: true,
      path: 'C:\\out\\uso.json'
    })
    expect(mocks.showSaveDialog).toHaveBeenCalledWith(
      win,
      expect.objectContaining({
        defaultPath: expect.stringMatching(/^kolnd-hub-uso-\d{8}\.json$/),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
    )
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      'C:\\out\\uso.json',
      `${JSON.stringify(mocks.readUsageEvents.mock.results[0].value, null, 2)}\n`,
      'utf8'
    )
  })

  it('exporta CSV usando o conversor do registro', async () => {
    mocks.readUsageEvents.mockReturnValue([{ ts: '2026-11-25T10:00:00.000Z', type: 'action' }])
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\out\\uso.csv' })

    await expect(call('usage:export', { format: 'csv' })).resolves.toEqual({
      success: true,
      path: 'C:\\out\\uso.csv'
    })
    expect(mocks.writeFileSync).toHaveBeenCalledWith('C:\\out\\uso.csv', 'csv,gerado', 'utf8')
  })

  it('sem janela principal usa o diálogo sem parent', async () => {
    mainWindow = null
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\out\\uso.json' })
    await call('usage:export', { format: 'json' })
    expect(mocks.showSaveDialog).toHaveBeenCalledWith(expect.any(Object))
  })

  it('formato inválido não abre o diálogo', async () => {
    await expect(call('usage:export', { format: 'xml' })).resolves.toEqual({
      success: false,
      error: 'Formato de exportação inválido.'
    })
    await expect(call('usage:export', null)).resolves.toEqual({
      success: false,
      error: 'Formato de exportação inválido.'
    })
    expect(mocks.showSaveDialog).not.toHaveBeenCalled()
  })

  it('cancelado não grava nada', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true })
    await expect(call('usage:export', { format: 'json' })).resolves.toEqual({
      success: false,
      canceled: true
    })
    expect(mocks.writeFileSync).not.toHaveBeenCalled()
  })

  it('falha de escrita vira erro com mensagem', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\out\\uso.csv' })
    mocks.writeFileSync.mockImplementationOnce(() => {
      throw new Error('disco cheio')
    })
    await expect(call('usage:export', { format: 'csv' })).resolves.toEqual({
      success: false,
      error: 'disco cheio'
    })
    expect(mocks.logError).toHaveBeenCalled()
  })
})

describe('usage:clear', () => {
  it('devolve o resultado da limpeza e registra no log', () => {
    expect(call('usage:clear')).toEqual({ success: true, removed: 2 })
    expect(mocks.logInfo).toHaveBeenCalled()
  })

  it('falha na limpeza é reportada sem lançar', () => {
    mocks.clearUsageFiles.mockReturnValue({ success: false, removed: 0, error: 'travado' })
    expect(call('usage:clear')).toEqual({ success: false, removed: 0, error: 'travado' })
    expect(mocks.logError).toHaveBeenCalled()
  })
})

describe('usage:page-view', () => {
  it('aceita só páginas da whitelist e grava o evento', () => {
    expect(call('usage:page-view', 'biblioteca')).toEqual({ success: true })
    expect(mocks.buildUsageEvent).toHaveBeenCalledWith('page-view', { page: 'biblioteca' })
    expect(mocks.appendUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'page-view', page: 'biblioteca' })
    )
  })

  it('página inválida não grava', () => {
    expect(call('usage:page-view', 'hack')).toEqual({
      success: false,
      error: 'Página inválida.'
    })
    expect(call('usage:page-view', null)).toEqual({
      success: false,
      error: 'Página inválida.'
    })
    expect(mocks.appendUsageEvent).not.toHaveBeenCalled()
  })
})
