// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryTurn } from '../../../../shared/ipc'
import { HistoryPanel, type HistoryPanelApi } from './HistoryPanel'

const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true

function turn(index: number, interrupted = false): HistoryTurn {
  return {
    role: index % 2 === 0 ? 'user' : 'model',
    text: `turno ${index}`,
    at: 1_700_000_000_000 + index * 1000,
    interrupted
  }
}

function makeApi(turns: HistoryTurn[], enabled = true): { api: HistoryPanelApi } {
  const api: HistoryPanelApi = {
    list: vi.fn(async () => ({ ok: true as const, enabled, turns }))
  }
  return { api }
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.restoreAllMocks()
})

describe('histórico recente', () => {
  it('lista 20', async () => {
    const turns = Array.from({ length: 20 }, (_, index) => turn(index))
    const { api } = makeApi(turns)

    await act(async () => {
      root.render(<HistoryPanel api={api} />)
    })
    await settle()

    expect(container.querySelectorAll('[data-history-turn]')).toHaveLength(20)
  })

  it('marca interrompido', async () => {
    const { api } = makeApi([turn(0), turn(1, true)])

    await act(async () => {
      root.render(<HistoryPanel api={api} />)
    })
    await settle()

    const items = container.querySelectorAll('[data-history-turn]')
    expect(items[0]?.querySelector('[data-history-interrupted]')).toBeNull()
    expect(items[1]?.querySelector('[data-history-interrupted]')?.textContent).toContain(
      'interrompido'
    )
  })

  it('copiar usa clipboard', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    const { api } = makeApi([turn(0)])

    await act(async () => {
      root.render(<HistoryPanel api={api} />)
    })
    await settle()

    const copy = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent?.trim() === 'Copiar'
    )
    if (!copy) throw new Error('botão copiar ausente')
    await act(async () => {
      copy.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    expect(writeText).toHaveBeenCalledWith('Você: turno 0')
  })

  it('vazio mostra explicação', async () => {
    const { api } = makeApi([])

    await act(async () => {
      root.render(<HistoryPanel api={api} />)
    })
    await settle()

    expect(container.querySelector('[data-history-empty]')?.textContent).toContain(
      'Nenhum turno registrado'
    )
  })
})
