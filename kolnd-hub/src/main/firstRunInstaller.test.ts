import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  checkDependencies: vi.fn(),
  installPython: vi.fn(),
  installKloudGames: vi.fn(),
  deployPrograms: vi.fn(),
  markFirstRunComplete: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('./dependencyChecker', () => ({
  checkDependencies: mocks.checkDependencies,
  formatDependencyReport: () => '=== relatório ==='
}))
vi.mock('./silentInstaller', () => ({
  installPython: mocks.installPython,
  installKloudGames: mocks.installKloudGames
}))
vi.mock('./programsDeployer', () => ({
  deployPrograms: mocks.deployPrograms,
  formatDeployReport: () => '=== deploy ==='
}))
vi.mock('./firstRun', () => ({ markFirstRunComplete: mocks.markFirstRunComplete }))

import { firstRunInstaller, registerFirstRunIpc } from './firstRunInstaller'

interface CapturedEvent {
  type: 'progress' | 'log' | 'complete'
  payload: { stepId?: string; status?: string; success?: boolean; error?: string }
}

function collect(): { events: CapturedEvent[]; stop: () => void } {
  const events: CapturedEvent[] = []
  const onProgress = (payload: CapturedEvent['payload']): void => {
    events.push({ type: 'progress', payload })
  }
  const onLog = (payload: string): void => {
    events.push({ type: 'log', payload: { error: payload } })
  }
  const onComplete = (payload: CapturedEvent['payload']): void => {
    events.push({ type: 'complete', payload })
  }
  firstRunInstaller.on('progress', onProgress)
  firstRunInstaller.on('log', onLog)
  firstRunInstaller.on('complete', onComplete)
  return {
    events,
    stop: () => {
      firstRunInstaller.off('progress', onProgress)
      firstRunInstaller.off('log', onLog)
      firstRunInstaller.off('complete', onComplete)
    }
  }
}

function progressOf(events: CapturedEvent[], stepId: string, status: string): boolean {
  return events.some(
    (e) => e.type === 'progress' && e.payload.stepId === stepId && e.payload.status === status
  )
}

/** Roda o install inteiro (com fake timers) e devolve os eventos capturados. */
async function runInstall(): Promise<{ events: CapturedEvent[]; stop: () => void }> {
  const collector = collect()
  const done = firstRunInstaller.install()
  await vi.runAllTimersAsync()
  await done
  collector.stop()
  return collector
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.checkDependencies.mockReset().mockResolvedValue({
    pythonInstalled: true,
    pythonVersion: '3.12.4',
    pipInstalled: true,
    allInstalled: true
  })
  mocks.installPython.mockReset().mockResolvedValue({ success: true })
  mocks.installKloudGames.mockReset().mockResolvedValue({ success: true, alreadyInstalled: false })
  mocks.deployPrograms.mockReset().mockResolvedValue([
    { id: 'mark-lvi', name: 'Mark LVI', installed: true },
    { id: 'kloud-games', name: 'Kloud Games', installed: true }
  ])
  mocks.markFirstRunComplete.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('firstRunInstaller.install — caminho feliz', () => {
  it('percorre todas as etapas, marca a primeira execução e conclui', async () => {
    const { events } = await runInstall()

    expect(mocks.checkDependencies).toHaveBeenCalledTimes(1)
    // Python e pip já instalados → não chama o instalador.
    expect(mocks.installPython).not.toHaveBeenCalled()
    expect(mocks.installKloudGames).toHaveBeenCalledTimes(1)
    expect(mocks.deployPrograms).toHaveBeenCalledTimes(1)
    expect(mocks.markFirstRunComplete).toHaveBeenCalledTimes(1)

    expect(progressOf(events, 'check', 'done')).toBe(true)
    expect(progressOf(events, 'python', 'done')).toBe(true)
    expect(progressOf(events, 'kloud-games', 'done')).toBe(true)
    expect(progressOf(events, 'programs', 'done')).toBe(true)
    expect(progressOf(events, 'finalize', 'done')).toBe(true)
    expect(events.at(-1)).toEqual({ type: 'complete', payload: { success: true } })
  })

  it('instala Python quando falta alguma dependência', async () => {
    mocks.checkDependencies.mockResolvedValue({
      pythonInstalled: false,
      pipInstalled: false,
      allInstalled: false
    })
    const { events } = await runInstall()
    expect(mocks.installPython).toHaveBeenCalledTimes(1)
    expect(
      events.some((e) => e.type === 'log' && String(e.payload.error).includes('[check] Faltam'))
    ).toBe(true)
    expect(events.at(-1)?.payload).toEqual({ success: true })
  })

  it('falta só pip → log de dependência e instalação mesmo assim', async () => {
    mocks.checkDependencies.mockResolvedValue({
      pythonInstalled: true,
      pipInstalled: false,
      allInstalled: false
    })
    const { events } = await runInstall()
    expect(
      events.some((e) => e.type === 'log' && String(e.payload.error).includes('Faltam: pip'))
    ).toBe(true)
  })

  it('Kloud Games já instalado → mensagem específica, sem falhar', async () => {
    mocks.installKloudGames.mockResolvedValue({ success: true, alreadyInstalled: true })
    const { events } = await runInstall()
    expect(
      events.some(
        (e) => e.type === 'log' && String(e.payload.error).includes('já instalado — pulando')
      )
    ).toBe(true)
    expect(events.at(-1)?.payload).toEqual({ success: true })
  })

  it('falha do Kloud Games (resultado) não bloqueia a primeira execução', async () => {
    mocks.installKloudGames.mockResolvedValue({ success: false, error: 'MSI ausente' })
    const { events } = await runInstall()
    expect(progressOf(events, 'kloud-games', 'error')).toBe(true)
    expect(events.at(-1)?.payload).toEqual({ success: true })
  })

  it('exceção do Kloud Games também é não fatal', async () => {
    mocks.installKloudGames.mockRejectedValue(new Error('boom'))
    const { events } = await runInstall()
    expect(
      events.some(
        (e) =>
          e.type === 'log' && String(e.payload.error).includes('[kloud-games] Erro (não fatal)')
      )
    ).toBe(true)
    expect(events.at(-1)?.payload).toEqual({ success: true })
  })

  it('programas parciais emitem aviso e continuam', async () => {
    mocks.deployPrograms.mockResolvedValue([
      { id: 'mark-lvi', name: 'Mark LVI', installed: true },
      { id: 'kloud-games', name: 'Kloud Games', installed: false }
    ])
    const { events } = await runInstall()
    expect(
      events.some(
        (e) =>
          e.type === 'log' && String(e.payload.error).includes('Aviso: Kloud Games não puderam')
      )
    ).toBe(true)
    expect(events.at(-1)?.payload).toEqual({ success: true })
  })
})

describe('firstRunInstaller.install — erros e cancelamento', () => {
  it('falha ao instalar Python interrompe com erro', async () => {
    mocks.checkDependencies.mockResolvedValue({
      pythonInstalled: false,
      pipInstalled: false,
      allInstalled: false
    })
    mocks.installPython.mockResolvedValue({ success: false, error: 'winget indisponível' })
    const { events } = await runInstall()
    expect(mocks.markFirstRunComplete).not.toHaveBeenCalled()
    expect(events.at(-1)).toEqual({
      type: 'complete',
      payload: { success: false, error: 'winget indisponível' }
    })
  })

  it('falha sem mensagem no Python usa o texto padrão', async () => {
    mocks.checkDependencies.mockResolvedValue({
      pythonInstalled: false,
      pipInstalled: false,
      allInstalled: false
    })
    mocks.installPython.mockResolvedValue({ success: false })
    const { events } = await runInstall()
    expect(events.at(-1)?.payload.error).toBe('Erro desconhecido ao instalar Python')
  })

  it('erro na verificação de dependências encerra com erro', async () => {
    mocks.checkDependencies.mockRejectedValue(new Error('spawn falhou'))
    const { events } = await runInstall()
    expect(progressOf(events, 'check', 'error')).toBe(true)
    expect(events.at(-1)?.payload).toEqual({ success: false, error: 'spawn falhou' })
  })

  it('erro não-Error na verificação é convertido em texto', async () => {
    mocks.checkDependencies.mockRejectedValue('falha crua')
    const { events } = await runInstall()
    expect(events.at(-1)?.payload).toEqual({ success: false, error: 'falha crua' })
  })

  it('nenhum programa implantado → erro', async () => {
    mocks.deployPrograms.mockResolvedValue([
      { id: 'mark-lvi', name: 'Mark LVI', installed: false },
      { id: 'kloud-games', name: 'Kloud Games', installed: false }
    ])
    const { events } = await runInstall()
    expect(progressOf(events, 'programs', 'error')).toBe(true)
    expect(events.at(-1)?.payload).toEqual({
      success: false,
      error: 'Nenhum programa pôde ser implantado/verificado.'
    })
  })

  it('exceção ao implantar programas propaga para o complete', async () => {
    mocks.deployPrograms.mockRejectedValue(new Error('disco cheio'))
    const { events } = await runInstall()
    expect(events.at(-1)?.payload).toEqual({ success: false, error: 'disco cheio' })
  })

  it('cancelamento antes da primeira etapa aborta sem marcar a flag', async () => {
    const collector = collect()
    const done = firstRunInstaller.install()
    firstRunInstaller.cancel()
    await vi.runAllTimersAsync()
    await done
    collector.stop()

    expect(mocks.markFirstRunComplete).not.toHaveBeenCalled()
    expect(collector.events.at(-1)).toEqual({
      type: 'complete',
      payload: { success: false, error: 'Instalação cancelada pelo usuário.' }
    })
  })

  it('cancelamento durante a etapa final também aborta', async () => {
    const collector = collect()
    firstRunInstaller.on('progress', (event: CapturedEvent['payload']) => {
      if (event.stepId === 'finalize' && event.status === 'running') firstRunInstaller.cancel()
    })
    const done = firstRunInstaller.install()
    await vi.runAllTimersAsync()
    await done
    collector.stop()

    expect(progressOf(collector.events, 'finalize', 'error')).toBe(true)
    expect(collector.events.at(-1)?.payload).toEqual({
      success: false,
      error: 'Instalação cancelada pelo usuário.'
    })
  })
})

describe('firstRunInstaller.retryKloudGames', () => {
  it('com instalação em andamento apenas loga e não instala de novo', async () => {
    let resolveDeps!: (value: unknown) => void
    mocks.checkDependencies.mockReturnValue(
      new Promise((resolve) => {
        resolveDeps = resolve
      })
    )
    const collector = collect()
    const done = firstRunInstaller.install()

    await firstRunInstaller.retryKloudGames()
    expect(mocks.installKloudGames).not.toHaveBeenCalled()
    expect(
      collector.events.some(
        (e) => e.type === 'log' && String(e.payload.error).includes('Aguarde a instalação')
      )
    ).toBe(true)

    resolveDeps({
      pythonInstalled: true,
      pipInstalled: true,
      allInstalled: true
    })
    await vi.runAllTimersAsync()
    await done
    collector.stop()
  })

  it('sem instalação em andamento roda apenas a etapa do Kloud Games', async () => {
    await firstRunInstaller.retryKloudGames()
    expect(mocks.installKloudGames).toHaveBeenCalledTimes(1)
    expect(mocks.checkDependencies).not.toHaveBeenCalled()
  })
})

describe('registerFirstRunIpc', () => {
  const send = vi.fn()
  let window: { webContents: { send: typeof send } } | null

  beforeAll(() => {
    window = { webContents: { send } }
    registerFirstRunIpc(() => window as unknown as BrowserWindow)
  })

  beforeEach(() => {
    send.mockReset()
    window = { webContents: { send } }
  })

  it('registra os três canais', () => {
    expect([...mocks.handlers.keys()].sort()).toEqual([
      'firstRun:cancel',
      'firstRun:retry-kloud-games',
      'firstRun:start'
    ])
  })

  it('firstRun:start dispara o install assíncrono e responde na hora', async () => {
    const installSpy = vi.spyOn(firstRunInstaller, 'install').mockResolvedValue(undefined)
    const result = await mocks.handlers.get('firstRun:start')?.({})
    expect(result).toEqual({ success: true })
    expect(installSpy).toHaveBeenCalledTimes(1)
    installSpy.mockRestore()
  })

  it('firstRun:start reporta erro inesperado do install no renderer', async () => {
    const installSpy = vi
      .spyOn(firstRunInstaller, 'install')
      .mockRejectedValueOnce(new Error('estourou'))
    await mocks.handlers.get('firstRun:start')?.({})
    await Promise.resolve()
    await Promise.resolve()

    expect(send).toHaveBeenCalledWith('firstRun:log', expect.stringContaining('estourou'))
    expect(send).toHaveBeenCalledWith('firstRun:complete', {
      success: false,
      error: 'estourou'
    })
    installSpy.mockRestore()
  })

  it('firstRun:cancel e firstRun:retry-kloud-games encaminham aos métodos do instalador', async () => {
    const cancelSpy = vi.spyOn(firstRunInstaller, 'cancel').mockImplementation(() => {})
    const retrySpy = vi.spyOn(firstRunInstaller, 'retryKloudGames').mockResolvedValue(undefined)

    expect(await mocks.handlers.get('firstRun:cancel')?.({})).toEqual({ success: true })
    expect(cancelSpy).toHaveBeenCalledTimes(1)

    expect(await mocks.handlers.get('firstRun:retry-kloud-games')?.({})).toEqual({
      success: true
    })
    expect(retrySpy).toHaveBeenCalledTimes(1)

    cancelSpy.mockRestore()
    retrySpy.mockRestore()
  })

  it('eventos do instalador são reenviados ao renderer', () => {
    firstRunInstaller.emit('progress', { stepId: 'check', status: 'running', progress: 0 })
    firstRunInstaller.emit('log', '[check] linha\n')
    firstRunInstaller.emit('complete', { success: true })

    expect(send).toHaveBeenCalledWith('firstRun:progress', {
      stepId: 'check',
      status: 'running',
      progress: 0
    })
    expect(send).toHaveBeenCalledWith('firstRun:log', '[check] linha\n')
    expect(send).toHaveBeenCalledWith('firstRun:complete', { success: true })
  })

  it('janela ausente não quebra o reenvio', () => {
    window = null
    expect(() => firstRunInstaller.emit('complete', { success: true })).not.toThrow()
  })
})
