// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { useGamesRunning } from './useGamesRunning'
import type { UseGamesRunningResult } from './useGamesRunning'
import type { Game } from '../types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const getRunningGames = vi.fn()

function game(id: string): Game {
  return {
    id,
    name: id,
    exePath: `C:\\jogos\\${id}.exe`,
    iconPath: null,
    origin: 'custom',
    addedAt: '2026-01-01T00:00:00.000Z'
  } as Game
}

let container: HTMLDivElement
let root: Root
let latest: UseGamesRunningResult
let mounted: boolean

function Harness({
  games,
  onResult
}: {
  games: Game[]
  onResult: (r: UseGamesRunningResult) => void
}): React.ReactNode {
  const result = useGamesRunning(games)
  onResult(result)
  return (
    <div>
      <output data-testid="ids">{[...result.runningIds].sort().join(',')}</output>
      <button
        type="button"
        onClick={() => {
          void result.refresh()
        }}
      >
        refresh
      </button>
    </div>
  )
}

function render(games: Game[]): void {
  act(() =>
    root.render(
      <Harness
        games={games}
        onResult={(result) => {
          latest = result
        }}
      />
    )
  )
}

function ids(): string {
  return container.querySelector('[data-testid="ids"]')?.textContent ?? ''
}

beforeEach(() => {
  vi.useFakeTimers()
  getRunningGames.mockReset()
  ;(window as unknown as { api: { getRunningGames: typeof getRunningGames } }).api = {
    getRunningGames
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mounted = true
})

afterEach(() => {
  if (mounted) act(() => root.unmount())
  container.remove()
  collect()
  vi.useRealTimers()
})

function collect(): void {
  delete (window as unknown as { api?: unknown }).api
}

describe('useGamesRunning', () => {
  it('lista vazia mantém o set vazio sem consultar a API', async () => {
    render([])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(getRunningGames).not.toHaveBeenCalled()
    expect(ids()).toBe('')
  })

  it('marca somente os jogos em execução', async () => {
    getRunningGames.mockResolvedValue({ ok: true, running: { a: true, b: false, c: true } })
    render([game('a'), game('b'), game('c')])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(getRunningGames).toHaveBeenCalledWith(['a', 'b', 'c'])
    expect(ids()).toBe('a,c')
  })

  it('resposta ok=false limpa o conjunto', async () => {
    getRunningGames.mockResolvedValue({ ok: true, running: { a: true } })
    render([game('a')])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(ids()).toBe('a')

    getRunningGames.mockResolvedValue({ ok: false, running: {} })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(ids()).toBe('')
  })

  it('falha na consulta mantém o último estado conhecido', async () => {
    getRunningGames.mockResolvedValue({ ok: true, running: { a: true } })
    render([game('a')])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    getRunningGames.mockRejectedValue(new Error('sem main'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(ids()).toBe('a')
  })

  it('sonda a cada 4 s e reconsulta quando a lista muda', async () => {
    getRunningGames.mockResolvedValue({ ok: true, running: {} })
    render([game('a')])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(getRunningGames).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(getRunningGames).toHaveBeenCalledTimes(2)

    render([game('a'), game('b')])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(getRunningGames).toHaveBeenLastCalledWith(['a', 'b'])
  })

  it('refresh() manual reconsulta imediatamente', async () => {
    getRunningGames.mockResolvedValue({ ok: true, running: { a: true } })
    render([game('a')])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    getRunningGames.mockClear()

    await act(async () => {
      await latest.refresh()
    })
    expect(getRunningGames).toHaveBeenCalledTimes(1)
  })

  it('desmontar limpa timer e intervalo (não consulta depois)', async () => {
    getRunningGames.mockResolvedValue({ ok: true, running: {} })
    render([game('a')])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const calls = getRunningGames.mock.calls.length

    act(() => root.unmount())
    mounted = false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000)
    })
    expect(getRunningGames).toHaveBeenCalledTimes(calls)
  })
})
