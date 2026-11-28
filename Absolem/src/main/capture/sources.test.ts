import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureSource } from '../../shared/screen'
import {
  SCREEN_SOURCE_CACHE_TTL_MS,
  SCREEN_THUMBNAIL_SIZE,
  SOURCE_THUMBNAIL_SIZE,
  createScreenSourceCache,
  listScreens,
  listSources,
  listWindows
} from './sources'

const state = vi.hoisted(() => ({
  getSources: vi.fn()
}))

vi.mock('electron', () => ({
  desktopCapturer: {
    getSources: state.getSources
  }
}))

function source(id: string, name: string, displayId?: string) {
  return { id, name, display_id: displayId }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.getSources.mockResolvedValue([
    source('window:5', 'Documento - Word'),
    source('screen:1:0', 'Tela 2', '1'),
    source('screen:0:0', 'Tela 1', '0'),
    source('window:9', '   ')
  ])
})

describe('fontes de captura', () => {
  it('lista telas e janelas', async () => {
    const sources = await listSources()

    expect(sources).toEqual([
      { id: 'window:5', name: 'Documento - Word', kind: 'window' },
      { id: 'screen:1:0', name: 'Tela 2', kind: 'screen', displayId: '1' },
      { id: 'screen:0:0', name: 'Tela 1', kind: 'screen', displayId: '0' }
    ])
    expect((await listScreens()).map((entry) => entry.displayId)).toEqual(['0', '1'])
    expect((await listWindows()).map((entry) => entry.id)).toEqual(['window:5'])
  })

  it('descarta fonte sem nome', async () => {
    state.getSources.mockResolvedValue([
      source('screen:0:0', 'Tela 1', '0'),
      source('', 'Sem id', '0'),
      source('window:9', '   ')
    ])

    const sources = await listSources()

    expect(sources).toEqual([{ id: 'screen:0:0', name: 'Tela 1', kind: 'screen', displayId: '0' }])
  })

  it('não pede ícones', async () => {
    await listSources()

    expect(state.getSources).toHaveBeenCalledWith({
      types: ['screen', 'window'],
      thumbnailSize: { ...SOURCE_THUMBNAIL_SIZE },
      fetchWindowIcons: false
    })
  })

  it('captura pede só telas, sem thumbnail', async () => {
    const screens = await listScreens()

    expect(screens.map((entry) => entry.displayId)).toEqual(['0', '1'])
    expect(state.getSources).toHaveBeenLastCalledWith({
      types: ['screen'],
      thumbnailSize: { ...SCREEN_THUMBNAIL_SIZE },
      fetchWindowIcons: false
    })
    expect(SCREEN_THUMBNAIL_SIZE).toEqual({ width: 0, height: 0 })
  })
})

describe('cache curto das telas', () => {
  it('reusa a listagem dentro do TTL e relista depois', async () => {
    let now = 1_000
    const getScreens = vi.fn(async () => [
      { id: 'screen:0:0', name: 'Tela 1', displayId: '0', kind: 'screen' as const }
    ])
    const cache = createScreenSourceCache({
      getScreens,
      getDisplayKey: () => '0',
      now: () => now,
      ttlMs: 1_000
    })

    expect(await cache.list()).toHaveLength(1)
    expect(cache.isCached()).toBe(false)
    now += 500
    expect(await cache.list()).toHaveLength(1)
    expect(cache.isCached()).toBe(true)
    expect(getScreens).toHaveBeenCalledTimes(1)

    now += 600
    await cache.list()
    expect(getScreens).toHaveBeenCalledTimes(2)
    expect(SCREEN_SOURCE_CACHE_TTL_MS).toBe(15_000)
  })

  it('monitor mudou descarta o cache mesmo dentro do TTL', async () => {
    let key = '0'
    const getScreens = vi.fn(async () => [
      { id: `screen:${key}:0`, name: `Tela ${key}`, displayId: key, kind: 'screen' as const }
    ])
    const cache = createScreenSourceCache({ getScreens, getDisplayKey: () => key })

    await cache.list()
    key = '0,1'
    const screens = await cache.list()

    expect(getScreens).toHaveBeenCalledTimes(2)
    expect(screens[0]?.displayId).toBe('0,1')
    cache.invalidate()
    await cache.list()
    expect(getScreens).toHaveBeenCalledTimes(3)
  })

  it('listagens concorrentes compartilham uma chamada', async () => {
    let release: (screens: never[]) => void = () => undefined
    const getScreens = vi.fn(
      () =>
        new Promise<never[]>((resolve) => {
          release = resolve
        })
    )
    const cache = createScreenSourceCache({ getScreens })

    const first = cache.list()
    const second = cache.list()
    expect(getScreens).toHaveBeenCalledTimes(1)
    release([])
    await expect(Promise.all([first, second])).resolves.toEqual([[], []])
  })

  it('falha não envenena o cache', async () => {
    const getScreens = vi
      .fn<() => Promise<CaptureSource[]>>()
      .mockRejectedValueOnce(new Error('desktopCapturer indisponível'))
      .mockResolvedValueOnce([
        { id: 'screen:0:0', name: 'Tela 1', displayId: '0', kind: 'screen' as const }
      ])
    const cache = createScreenSourceCache({ getScreens })

    await expect(cache.list()).rejects.toThrow('indisponível')
    await expect(cache.list()).resolves.toHaveLength(1)
    expect(getScreens).toHaveBeenCalledTimes(2)
  })
})
