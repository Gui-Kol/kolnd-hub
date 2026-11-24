import { beforeEach, describe, expect, it, vi } from 'vitest'

const { treeKillMock, listRunningProcessesMock } = vi.hoisted(() => ({
  treeKillMock: vi.fn(),
  listRunningProcessesMock: vi.fn()
}))

// Nada de processo real: tanto a listagem quanto o kill são simulados.
vi.mock('tree-kill', () => ({ default: treeKillMock, __esModule: true }))
vi.mock('./startupManager', () => ({ listRunningProcesses: listRunningProcessesMock }))

import { executableNameFromCommand, killProcessesForCommand } from './processKiller'

beforeEach(() => {
  treeKillMock.mockReset()
  listRunningProcessesMock.mockReset()
})

describe('executableNameFromCommand', () => {
  it('extrai o basename sem extensão e em minúsculas', () => {
    expect(executableNameFromCommand('C:\\Programas\\Jogo.EXE')).toBe('jogo')
    expect(executableNameFromCommand('C:\\x\\script.PS1')).toBe('script')
    expect(executableNameFromCommand('D:/Apps/tool.cmd')).toBe('tool')
  })

  it('descarta argumentos e aceita caminho entre aspas', () => {
    expect(executableNameFromCommand('"C:\\Meu Jogo\\game.exe" --fullscreen')).toBe('game')
    expect(executableNameFromCommand('C:\\Jogo\\game.exe -windowed')).toBe('game')
  })

  it('aspas sem fechamento usam o resto do comando', () => {
    expect(executableNameFromCommand('"C:\\Jogo\\game.exe')).toBe('game')
  })

  it('comando vazio ou só espaços → string vazia', () => {
    expect(executableNameFromCommand('')).toBe('')
    expect(executableNameFromCommand('   ')).toBe('')
    expect(executableNameFromCommand('""')).toBe('')
  })
})

describe('killProcessesForCommand — validações', () => {
  it('comando sem executável → erro', async () => {
    expect(await killProcessesForCommand('')).toEqual({
      success: false,
      error: 'Não foi possível identificar o executável do comando',
      killed: []
    })
    expect(listRunningProcessesMock).not.toHaveBeenCalled()
  })

  it('interpretador/shell genérico é recusado sem listar processos', async () => {
    const result = await killProcessesForCommand('python main.py')
    expect(result.success).toBe(false)
    expect(result.error).toContain('interpretador/shell genérico')
    expect(listRunningProcessesMock).not.toHaveBeenCalled()
  })

  it('falha ao listar processos → erro com a mensagem original', async () => {
    listRunningProcessesMock.mockImplementation(() => {
      throw new Error('ps indisponível')
    })
    expect(await killProcessesForCommand('C:\\Jogo\\game.exe')).toEqual({
      success: false,
      error: 'Não foi possível listar os processos: ps indisponível',
      killed: []
    })
  })

  it('erro não-Error na listagem também é convertido em texto', async () => {
    listRunningProcessesMock.mockImplementation(() => {
      throw 'falha crua'
    })
    expect((await killProcessesForCommand('C:\\Jogo\\game.exe')).error).toBe(
      'Não foi possível listar os processos: falha crua'
    )
  })
})

describe('killProcessesForCommand — casamento e kill', () => {
  it('nenhum processo correspondente → erro', async () => {
    listRunningProcessesMock.mockReturnValue([
      { id: 1, name: 'outro', path: 'C:\\outro.exe' },
      { id: 2, name: null, path: '' }
    ])
    expect(await killProcessesForCommand('C:\\Jogo\\game.exe')).toEqual({
      success: false,
      error: 'Processo não está em execução',
      killed: []
    })
    expect(treeKillMock).not.toHaveBeenCalled()
  })

  it('casa por nome e por basename do caminho, ignorando caixa/extensão', async () => {
    listRunningProcessesMock.mockReturnValue([
      { id: 10, name: 'GAME', path: 'C:\\A\\game.exe' },
      { id: 20, name: 'outro', path: 'C:\\Jogo\\GAME.EXE' },
      { id: 30, name: 'outro', path: 'C:\\Jogo\\game2.exe' }
    ])
    treeKillMock.mockImplementation((_pid: number, _sig: string, cb: (err?: Error) => void) => {
      cb(undefined)
    })

    const result = await killProcessesForCommand('C:\\Jogo\\game.exe')
    expect(result).toEqual({ success: true, killed: [10, 20] })
  })

  it('todas as falhas de kill → erro com a primeira mensagem', async () => {
    listRunningProcessesMock.mockReturnValue([{ id: 7, name: 'game', path: 'C:\\game.exe' }])
    treeKillMock.mockImplementation((_pid: number, _sig: string, cb: (err?: Error) => void) => {
      cb(new Error('acesso negado'))
    })
    expect(await killProcessesForCommand('C:\\game.exe')).toEqual({
      success: false,
      error: 'acesso negado',
      killed: []
    })
  })

  it('falha sem mensagem usa o fallback', async () => {
    listRunningProcessesMock.mockReturnValue([{ id: 7, name: 'game', path: 'C:\\game.exe' }])
    treeKillMock.mockImplementation((_pid: number, _sig: string, cb: (err?: Error) => void) => {
      // Erro sem `message` (ex.: objeto cru): cai no texto padrão.
      cb({} as Error)
    })
    expect((await killProcessesForCommand('C:\\game.exe')).error).toBe(
      'Falha ao encerrar o processo'
    )
  })

  it('sucesso parcial resolve ok com os pids encerrados', async () => {
    listRunningProcessesMock.mockReturnValue([
      { id: 1, name: 'game', path: '' },
      { id: 2, name: 'game', path: '' }
    ])
    treeKillMock.mockImplementation((pid: number, _sig: string, cb: (err?: Error) => void) => {
      if (pid === 2) cb(new Error('negado'))
      else cb(undefined)
    })
    expect(await killProcessesForCommand('game.exe')).toEqual({ success: true, killed: [1] })
  })
})
