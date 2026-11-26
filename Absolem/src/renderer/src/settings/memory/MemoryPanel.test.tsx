// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoryPanelApi } from './MemoryPanel'
import type { MemoryRecord } from '../../../../shared/memory'

const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true

import { MemoryPanel } from './MemoryPanel'

function memory(id: string, content: string, kind: MemoryRecord['kind'] = 'fact'): MemoryRecord {
  return {
    id,
    kind,
    content,
    tags: ['tag'],
    confidence: 0.8,
    source: 'manual',
    createdAt: 1000,
    updatedAt: 2000,
    lastUsedAt: null,
    useCount: 1,
    expiresAt: null,
    pinned: false
  }
}

function makeApi(all: MemoryRecord[]): {
  api: MemoryPanelApi
  list: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
} {
  const list = vi.fn(async (request?: { query?: string; kind?: string }) => {
    const query = request?.query?.toLocaleLowerCase('pt-BR') ?? ''
    const filtered = all.filter(
      (item) =>
        item.content.toLocaleLowerCase('pt-BR').includes(query) &&
        (request?.kind === undefined || item.kind === request.kind)
    )
    return {
      ok: true as const,
      memories: filtered,
      total: filtered.length,
      hasMore: false,
      archived: [],
      maintenance: []
    }
  })
  const update = vi.fn(async (request: { id: string }) => ({
    ok: true as const,
    memory: { ...memory(request.id, 'atualizado') }
  }))
  const remove = vi.fn(async () => ({ ok: true as const, removed: true }))

  const api: MemoryPanelApi = {
    list,
    search: vi.fn(async () => ({ ok: true as const, memories: all })),
    create: vi.fn(async () => ({ ok: true as const, memory: all[0] ?? memory('x', 'x') })),
    update,
    remove,
    removeAll: vi.fn(async () => ({ ok: true as const, removed: 3, turns: 0, sessions: 0 })),
    stats: vi.fn(async () => ({
      ok: true as const,
      stats: {
        total: all.length,
        byKind: { fact: all.length, preference: 0, profile: 0, temporary: 0 },
        oldest: 1000,
        newest: 2000,
        pinned: 0,
        approxBytes: 42,
        lastExtractionAt: null,
        lastConsolidationAt: null,
        maintenance: []
      }
    })),
    export: vi.fn(async () => ({ ok: true as const, canceled: true })),
    import: vi.fn(async () => ({ ok: true as const, canceled: true })),
    storeGet: vi.fn(async () => ({
      ok: true as const,
      key: 'memory' as const,
      value: { enabled: true, autoExtract: true, lastConsolidationAt: null }
    })),
    storeSet: vi.fn(async () => ({ ok: true as const }))
  }
  return { api, list, update, remove }
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === label
  )
  if (!found) throw new Error(`botão ausente: ${label}`)
  return found as HTMLButtonElement
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
  descriptor?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
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
})

describe('tela de memória', () => {
  it('lista renderiza 3 itens', async () => {
    const { api } = makeApi([
      memory('1', 'Gosta de café'),
      memory('2', 'Trabalha na Kolnd'),
      memory('3', 'Tem dois gatos')
    ])

    await act(async () => {
      root.render(<MemoryPanel api={api} />)
    })
    await settle()

    expect(container.querySelectorAll('[data-memory-item]')).toHaveLength(3)
  })

  it('editar chama IPC com patch', async () => {
    const { api, update } = makeApi([memory('1', 'Gosta de café')])

    await act(async () => {
      root.render(<MemoryPanel api={api} />)
    })
    await settle()

    await act(async () => {
      button(container, 'Editar').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const textarea = container.querySelector<HTMLTextAreaElement>('#memory-content-1')
    if (!textarea) throw new Error('textarea ausente')
    await act(async () => {
      setValue(textarea, 'Gosta de café sem açúcar')
    })
    await act(async () => {
      button(container, 'Salvar').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    expect(update).toHaveBeenCalledWith({
      id: '1',
      patch: { content: 'Gosta de café sem açúcar', tags: ['tag'] }
    })
  })

  it('apagar pede confirmação', async () => {
    const { api, remove } = makeApi([memory('1', 'Gosta de café')])

    await act(async () => {
      root.render(<MemoryPanel api={api} />)
    })
    await settle()

    await act(async () => {
      button(container, 'Apagar').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(remove).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Apagar esta memória?')

    await act(async () => {
      button(container, 'Confirmar').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    expect(remove).toHaveBeenCalledWith({ id: '1' })
  })

  it('busca filtra', async () => {
    const { api, list } = makeApi([
      memory('1', 'Gosta de café'),
      memory('2', 'Trabalha na Kolnd'),
      memory('3', 'Tem dois gatos')
    ])

    await act(async () => {
      root.render(<MemoryPanel api={api} />)
    })
    await settle()
    expect(container.querySelectorAll('[data-memory-item]')).toHaveLength(3)

    const search = container.querySelector('#memory-search')
    if (!search) throw new Error('busca ausente')
    await act(async () => {
      setValue(search as HTMLInputElement, 'café')
    })
    await settle()

    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'café' }))
    expect(container.querySelectorAll('[data-memory-item]')).toHaveLength(1)
    expect(container.textContent).toContain('Gosta de café')
    expect(container.textContent).not.toContain('Tem dois gatos')
  })
})
