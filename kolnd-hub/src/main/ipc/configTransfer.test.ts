import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showSaveDialog: vi.fn(),
  showOpenDialog: vi.fn(),
  getPath: vi.fn(() => 'C:\\fake\\userdata'),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  buildExport: vi.fn(() => ({ apps: [], games: [] })),
  validateImport: vi.fn(),
  summarizeImport: vi.fn(() => ({ apps: 1, games: 2, sections: ['apps'] })),
  applyImport: vi.fn<
    () => { applied: string[]; failed: Array<{ section: string; error: string }> }
  >(() => ({ applied: ['apps'], failed: [] })),
  isStoreAvailable: vi.fn(() => true),
  appendUsageEvent: vi.fn(() => true),
  logInfo: vi.fn(),
  logError: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
  dialog: { showSaveDialog: mocks.showSaveDialog, showOpenDialog: mocks.showOpenDialog },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('fs', () => ({
  mkdirSync: mocks.mkdirSync,
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync
}))
vi.mock('../configTransfer', () => ({
  buildExport: mocks.buildExport,
  validateImport: mocks.validateImport,
  summarizeImport: mocks.summarizeImport,
  applyImport: mocks.applyImport
}))
vi.mock('../store', () => ({ isStoreAvailable: mocks.isStoreAvailable }))
vi.mock('../usageLog', () => ({
  appendUsageEvent: mocks.appendUsageEvent,
  buildUsageEvent: (type: string, input: Record<string, unknown> = {}) => ({
    ts: '2026-11-25T10:00:00.000Z',
    type,
    ...input
  })
}))
vi.mock('../logger', () => ({
  logger: { info: mocks.logInfo, warn: vi.fn(), error: mocks.logError, debug: vi.fn() }
}))

import { registerConfigTransferIpc } from './configTransfer'
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
  vi.useRealTimers()
  mocks.handlers.clear()
  vi.clearAllMocks()
  mainWindow = win
  mocks.buildExport.mockReturnValue({ apps: [], games: [] })
  mocks.validateImport.mockReturnValue({
    ok: true,
    data: { apps: [] },
    rejected: [{ section: 'games', error: 'inválido' }]
  })
  mocks.summarizeImport.mockReturnValue({ apps: 1, games: 2, sections: ['apps'] })
  mocks.applyImport.mockReturnValue({ applied: ['apps'], failed: [] })
  mocks.isStoreAvailable.mockReturnValue(true)
  registerConfigTransferIpc(ctx)
})

describe('config:export', () => {
  it('grava o JSON no caminho escolhido (com janela principal)', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\out\\config.json' })
    expect(await call('config:export')).toEqual({ success: true, path: 'C:\\out\\config.json' })
    expect(mocks.showSaveDialog).toHaveBeenCalledWith(win, expect.any(Object))
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      'C:\\out\\config.json',
      JSON.stringify({ apps: [], games: [] }, null, 2),
      'utf8'
    )
    expect(mocks.appendUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'action', action: 'config-export' })
    )
  })

  it('sem janela principal usa o diálogo sem parent', async () => {
    mainWindow = null
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\out\\c.json' })
    await call('config:export')
    expect(mocks.showSaveDialog).toHaveBeenCalledWith(expect.any(Object))
  })

  it('cancelado não grava nada', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true })
    expect(await call('config:export')).toEqual({ success: false, canceled: true })
    expect(mocks.writeFileSync).not.toHaveBeenCalled()
    expect(mocks.appendUsageEvent).not.toHaveBeenCalled()
  })

  it('filePath vazio também conta como cancelado', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '' })
    expect(await call('config:export')).toEqual({ success: false, canceled: true })
  })

  it('falha de escrita vira erro com mensagem', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\out\\c.json' })
    mocks.writeFileSync.mockImplementationOnce(() => {
      throw new Error('disco cheio')
    })
    expect(await call('config:export')).toEqual({ success: false, error: 'disco cheio' })
    expect(mocks.logError).toHaveBeenCalled()
  })

  it('erro não-Error também é convertido', async () => {
    mocks.showSaveDialog.mockRejectedValueOnce('falha crua')
    expect(await call('config:export')).toEqual({ success: false, error: 'falha crua' })
  })
})

describe('config:import — validação de modo', () => {
  it('payload ausente/ inválido → erro de modo', async () => {
    expect(await call('config:import', null)).toEqual({
      success: false,
      error: 'Modo de importação inválido.'
    })
    expect(await call('config:import', 'preview')).toEqual({
      success: false,
      error: 'Modo de importação inválido.'
    })
    expect(await call('config:import', { mode: 'outro' })).toEqual({
      success: false,
      error: 'Modo de importação inválido.'
    })
  })
})

describe('config:import — preview', () => {
  it('cancelado → canceled', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await call('config:import', { mode: 'preview' })).toEqual({
      ok: false,
      canceled: true
    })
  })

  it('lista vazia de arquivos → canceled', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] })
    expect(await call('config:import', { mode: 'preview' })).toEqual({
      ok: false,
      canceled: true
    })
  })

  it('sem janela principal abre o diálogo sem parent', async () => {
    mainWindow = null
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\in.json'] })
    mocks.readFileSync.mockReturnValue('{}')
    await call('config:import', { mode: 'preview' })
    expect(mocks.showOpenDialog).toHaveBeenCalledWith(expect.any(Object))
  })

  it('falha de leitura → erro amigável', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\in.json'] })
    mocks.readFileSync.mockImplementation(() => {
      throw new Error('EACCES')
    })
    expect(await call('config:import', { mode: 'preview' })).toEqual({
      ok: false,
      errors: ['Não foi possível ler o arquivo selecionado.']
    })
  })

  it('JSON inválido → erro de formato', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\in.json'] })
    mocks.readFileSync.mockReturnValue('{ quebrado')
    expect(await call('config:import', { mode: 'preview' })).toEqual({
      ok: false,
      errors: ['O arquivo não contém um JSON válido.']
    })
  })

  it('validação recusada → erros e prévia limpa', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\in.json'] })
    mocks.readFileSync.mockReturnValue('{}')
    mocks.validateImport.mockReturnValue({ ok: false, errors: ['campo x inválido'] })

    expect(await call('config:import', { mode: 'preview' })).toEqual({
      ok: false,
      errors: ['campo x inválido']
    })
    // Sem prévia válida, o apply é recusado.
    expect(await call('config:import', { mode: 'apply' })).toEqual({
      success: false,
      error: 'Nenhuma importação pendente — pré-visualize primeiro.'
    })
  })

  it('sucesso guarda a prévia e devolve resumo + recusadas', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\in.json'] })
    mocks.readFileSync.mockReturnValue('{"apps":[]}')

    expect(await call('config:import', { mode: 'preview' })).toEqual({
      ok: true,
      summary: { apps: 1, games: 2, sections: ['apps'] },
      rejected: [{ section: 'games', error: 'inválido' }]
    })
    expect(mocks.logInfo).toHaveBeenCalledWith(
      'configTransfer',
      expect.stringContaining('Prévia de importação')
    )
  })

  it('exceção do diálogo vira erro com message', async () => {
    mocks.showOpenDialog.mockRejectedValueOnce(new Error('diálogo quebrou'))
    expect(await call('config:import', { mode: 'preview' })).toEqual({
      ok: false,
      errors: ['diálogo quebrou']
    })
  })
})

describe('config:import — apply', () => {
  async function previewOk(): Promise<void> {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\in.json'] })
    mocks.readFileSync.mockReturnValue('{}')
    await call('config:import', { mode: 'preview' })
  }

  it('sem prévia → erro', async () => {
    // Consome qualquer prévia deixada por outro teste (ordem segura).
    await call('config:import', { mode: 'apply' })
    expect(await call('config:import', { mode: 'apply' })).toEqual({
      success: false,
      error: 'Nenhuma importação pendente — pré-visualize primeiro.'
    })
  })

  it('prévia expirada (TTL 5 min) → erro e prévia limpa', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    await previewOk()
    vi.setSystemTime(new Date('2026-01-01T00:06:00.000Z'))

    expect(await call('config:import', { mode: 'apply' })).toEqual({
      success: false,
      error: 'A prévia expirou — pré-visualize o arquivo novamente.'
    })
  })

  it('store indisponível → erro sem backup', async () => {
    await previewOk()
    mocks.isStoreAvailable.mockReturnValue(false)
    expect(await call('config:import', { mode: 'apply' })).toEqual({
      success: false,
      error: 'Store persistente indisponível'
    })
    expect(mocks.writeFileSync).not.toHaveBeenCalled()
  })

  it('falha no backup aborta a importação (fail-closed)', async () => {
    await previewOk()
    mocks.mkdirSync.mockImplementationOnce(() => {
      throw new Error('sem permissão')
    })

    expect(await call('config:import', { mode: 'apply' })).toEqual({
      success: false,
      error: 'Não foi possível criar o backup automático. A importação não foi aplicada.'
    })
    expect(mocks.applyImport).not.toHaveBeenCalled()
  })

  it('sucesso cria backup, aplica e devolve o relatório', async () => {
    await previewOk()
    mocks.applyImport.mockReturnValue({
      applied: ['apps'],
      failed: [{ section: 'games', error: 'x' }]
    })

    const result = (await call('config:import', { mode: 'apply' })) as {
      success: boolean
      applied: string[]
      failed: unknown[]
      backupPath: string
    }
    expect(result.success).toBe(true)
    expect(result.applied).toEqual(['apps'])
    expect(result.failed).toHaveLength(1)
    expect(result.backupPath).toContain('config-backup-')
    expect(mocks.mkdirSync).toHaveBeenCalledWith('C:\\fake\\userdata\\backups', { recursive: true })
    expect(mocks.applyImport).toHaveBeenCalled()
    expect(mocks.appendUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'action', action: 'config-import' })
    )
  })

  it('aplica só uma vez (prévia é consumida)', async () => {
    await previewOk()
    expect((await call('config:import', { mode: 'apply' })) as { success: boolean }).toMatchObject({
      success: true
    })
    expect(await call('config:import', { mode: 'apply' })).toEqual({
      success: false,
      error: 'Nenhuma importação pendente — pré-visualize primeiro.'
    })
  })
})
