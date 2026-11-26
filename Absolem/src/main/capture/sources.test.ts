import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listScreens, listSources, listWindows, SOURCE_THUMBNAIL_SIZE } from './sources'

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
})
