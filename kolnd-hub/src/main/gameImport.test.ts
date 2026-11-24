import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameSourceImportReport } from '../shared/gameImport'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  scanSteamGames: vi.fn(),
  scanEpicGames: vi.fn(),
  scanMinecraftLauncher: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('./steamScanner', () => ({ scanSteamGames: mocks.scanSteamGames }))
vi.mock('./epicScanner', () => ({ scanEpicGames: mocks.scanEpicGames }))
vi.mock('./minecraftScanner', () => ({
  scanMinecraftLauncher: mocks.scanMinecraftLauncher
}))
vi.mock('./logger', () => ({
  logger: { info: mocks.logInfo, warn: vi.fn(), error: mocks.logError, debug: vi.fn() }
}))

import { importGamesFromAllSources, registerGameImportIpc } from './gameImport'
import type { GameImportSource } from './gameImport'

/** Relatório mínimo de uma fonte para os testes do orquestrador. */
function sourceReport(
  source: GameSourceImportReport['source'],
  overrides: Partial<GameSourceImportReport> = {}
): GameSourceImportReport {
  return {
    source,
    label: source === 'steam' ? 'Steam' : source === 'epic' ? 'Epic Games' : 'Minecraft Launcher',
    detected: true,
    imported: 0,
    alreadyInLibrary: 0,
    ignored: 0,
    noExe: 0,
    errors: [],
    ...overrides
  }
}

function source(id: GameImportSource['id'], scan: GameImportSource['scan']): GameImportSource {
  return {
    id,
    label: id === 'steam' ? 'Steam' : id === 'epic' ? 'Epic Games' : 'Minecraft Launcher',
    scan
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.scanSteamGames.mockResolvedValue(sourceReport('steam'))
  mocks.scanEpicGames.mockResolvedValue(sourceReport('epic'))
  mocks.scanMinecraftLauncher.mockResolvedValue(sourceReport('minecraft'))
})

describe('importGamesFromAllSources', () => {
  it('roda as fontes em sequência, agrega os relatórios e soma os importados', async () => {
    const order: string[] = []
    const report = await importGamesFromAllSources([
      source('steam', async () => {
        order.push('steam')
        return sourceReport('steam', { imported: 2 })
      }),
      source('epic', async () => {
        order.push('epic')
        return sourceReport('epic', { imported: 1 })
      }),
      source('minecraft', async () => {
        order.push('minecraft')
        return sourceReport('minecraft', { detected: false, message: 'Não encontrado.' })
      })
    ])

    expect(order).toEqual(['steam', 'epic', 'minecraft'])
    expect(report.ok).toBe(true)
    expect(report.imported).toBe(3)
    expect(report.sources.map((entry) => entry.source)).toEqual(['steam', 'epic', 'minecraft'])
    expect(report.sources[2]).toMatchObject({ detected: false, message: 'Não encontrado.' })
  })

  it('fonte não detectada não vira erro e as demais continuam', async () => {
    const report = await importGamesFromAllSources([
      source('steam', async () =>
        sourceReport('steam', { detected: false, message: 'Steam não detectada.' })
      ),
      source('epic', async () => sourceReport('epic', { imported: 4 }))
    ])

    expect(report.ok).toBe(true)
    expect(report.imported).toBe(4)
    expect(report.sources[0]).toMatchObject({
      detected: false,
      errors: [],
      message: 'Steam não detectada.'
    })
  })

  it('falha isolada de uma fonte não aborta as seguintes', async () => {
    const report = await importGamesFromAllSources([
      source('epic', async () => {
        throw new Error('manifesto corrompido')
      }),
      source('steam', async () => sourceReport('steam', { imported: 1 }))
    ])

    expect(report.ok).toBe(true)
    expect(report.imported).toBe(1)
    expect(report.sources[0]).toMatchObject({
      source: 'epic',
      label: 'Epic Games',
      detected: true,
      imported: 0,
      errors: ['manifesto corrompido'],
      message: 'Não foi possível buscar os jogos de Epic Games.'
    })
    expect(mocks.logError).toHaveBeenCalled()
    expect(report.sources[1].imported).toBe(1)
  })

  it('falha sem Error usa mensagem padrão amigável', async () => {
    const report = await importGamesFromAllSources([
      source('minecraft', async () => {
        throw 'falha estranha'
      })
    ])

    expect(report.sources[0].errors).toEqual(['Ocorreu um erro inesperado ao procurar os jogos.'])
  })

  it('lista vazia devolve relatório ok com zero importados', async () => {
    await expect(importGamesFromAllSources([])).resolves.toEqual({
      ok: true,
      sources: [],
      imported: 0
    })
  })
})

describe('registerGameImportIpc', () => {
  it('registra games:import-all e devolve o relatório agregado', async () => {
    registerGameImportIpc()
    const handler = mocks.handlers.get('games:import-all')
    expect(handler).toBeDefined()
    await expect(handler?.({})).resolves.toMatchObject({ ok: true, imported: 0 })
    expect(mocks.scanSteamGames).toHaveBeenCalled()
    expect(mocks.scanEpicGames).toHaveBeenCalled()
    expect(mocks.scanMinecraftLauncher).toHaveBeenCalled()
  })
})
