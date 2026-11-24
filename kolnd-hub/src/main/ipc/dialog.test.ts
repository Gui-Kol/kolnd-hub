import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showOpenDialog: vi.fn(),
  existsSync: vi.fn(),
  resolvePath: vi.fn((path: string) => path)
}))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: mocks.showOpenDialog },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('fs', () => ({ existsSync: mocks.existsSync }))
vi.mock('../processManager', () => ({ resolvePath: mocks.resolvePath }))

import { registerDialogIpc } from './dialog'
import type { IpcContext } from './lifecycle'

const win = { id: 1 }
let mainWindow: typeof win | null = win
const ctx = { getMainWindow: () => mainWindow } as unknown as IpcContext

function call(...args: unknown[]): unknown {
  return mocks.handlers.get('dialog:pick-path')?.({}, ...args)
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  mainWindow = win
  mocks.existsSync.mockReturnValue(false)
  registerDialogIpc(ctx)
})

describe('dialog:pick-path', () => {
  it('sem janela principal → erro', async () => {
    mainWindow = null
    expect(await call('file')).toEqual({
      success: false,
      error: 'Janela principal não está disponível.'
    })
  })

  it('modo file abre com filtros de executáveis e devolve o caminho', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\app.exe'] })
    expect(await call('file')).toEqual({ success: true, path: 'C:\\app.exe' })

    const options = mocks.showOpenDialog.mock.calls[0][1]
    expect(options.title).toBe('Selecionar o executável do programa')
    expect(options.properties).toEqual(['openFile'])
    expect(options.filters[0].extensions).toEqual(['exe', 'bat', 'cmd', 'ps1', 'com'])
  })

  it('modo directory abre com openDirectory/createDirectory', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\pasta'] })
    await call('directory')

    const options = mocks.showOpenDialog.mock.calls[0][1]
    expect(options.title).toBe('Selecionar a pasta de instalação do programa')
    expect(options.properties).toEqual(['openDirectory', 'createDirectory'])
  })

  it('título customizado é validado e limitado a 120 chars', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\x'] })
    await call('file', undefined, '  Escolha o jogo  ')
    expect(mocks.showOpenDialog.mock.calls[0][1].title).toBe('Escolha o jogo')

    await call('file', undefined, 'x'.repeat(200))
    expect(mocks.showOpenDialog.mock.calls[1][1].title).toHaveLength(120)

    await call('file', undefined, '   ')
    expect(mocks.showOpenDialog.mock.calls[2][1].title).toBe('Selecionar o executável do programa')
  })

  it('currentValue de arquivo existente abre no diretório-pai (modo file)', async () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await call('file', ' "C:\\Jogos\\jogo.exe" ')
    expect(mocks.resolvePath).toHaveBeenCalledWith('C:\\Jogos\\jogo.exe')
    expect(mocks.showOpenDialog.mock.calls[0][1].defaultPath).toBe('C:\\Jogos')
  })

  it('diretório existente no modo directory é usado como defaultPath', async () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await call('directory', 'C:\\Jogos')
    expect(mocks.showOpenDialog.mock.calls[0][1].defaultPath).toBe('C:\\Jogos')
  })

  it('modo directory com .exe existente usa o diretório-pai', async () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await call('directory', 'C:\\Jogos\\jogo.exe')
    expect(mocks.showOpenDialog.mock.calls[0][1].defaultPath).toBe('C:\\Jogos')
  })

  it('caminho inexistente cai no diretório-pai quando ele existe', async () => {
    mocks.existsSync.mockImplementation((path: string) => path === 'C:\\Jogos')
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await call('file', 'C:\\Jogos\\nao-existe.exe')
    expect(mocks.showOpenDialog.mock.calls[0][1].defaultPath).toBe('C:\\Jogos')
  })

  it('caminho inexistente sem pasta-pai existente fica sem defaultPath', async () => {
    mocks.existsSync.mockReturnValue(false)
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await call('file', 'C:\\Nada\\x.exe')
    expect(mocks.showOpenDialog.mock.calls[0][1].defaultPath).toBeUndefined()
  })

  it('cancelado e lista vazia → canceled', async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await call('file')).toEqual({ success: false, canceled: true })
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] })
    expect(await call('file')).toEqual({ success: false, canceled: true })
  })

  it('exceção do diálogo vira erro', async () => {
    mocks.showOpenDialog.mockRejectedValueOnce(new Error('diálogo morreu'))
    expect(await call('file')).toEqual({ success: false, error: 'diálogo morreu' })
  })
})
