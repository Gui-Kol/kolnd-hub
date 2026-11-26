import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTrayMenuTemplate } from './menu'
import type { TrayHandlers } from './menu'

const state = vi.hoisted(() => ({
  appQuit: vi.fn()
}))

vi.mock('electron', () => ({
  app: { quit: state.appQuit }
}))

function makeHandlers(): TrayHandlers {
  return {
    showOverlay: vi.fn(),
    openSettings: vi.fn(),
    quit: vi.fn()
  }
}

function click(item: { click?: unknown }): void {
  ;(item.click as () => void)()
}

beforeEach(() => {
  state.appQuit.mockReset()
})

describe('buildTrayMenuTemplate', () => {
  it('mantém a ordem dos itens', () => {
    const template = buildTrayMenuTemplate(makeHandlers())
    const order = template.map((item) => (item.type === 'separator' ? 'separator' : item.label))

    expect(order).toEqual(['Abrir Overlay', 'Configurações', 'separator', 'Sair'])
  })

  it('tem um único separador', () => {
    const template = buildTrayMenuTemplate(makeHandlers())

    expect(template.filter((item) => item.type === 'separator')).toHaveLength(1)
  })

  it('Sair chama o handler de saída, não app.quit direto', () => {
    const handlers = makeHandlers()
    const template = buildTrayMenuTemplate(handlers)
    const quitItem = template.find((item) => item.label === 'Sair')

    if (!quitItem) throw new Error('item Sair ausente')
    click(quitItem)

    expect(handlers.quit).toHaveBeenCalledTimes(1)
    expect(state.appQuit).not.toHaveBeenCalled()
  })
})
