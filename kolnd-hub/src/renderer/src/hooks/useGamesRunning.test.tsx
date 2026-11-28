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
const onProcessWatchUpdate = vi.fn()
const startProcessWatch = vi.fn(async () => ({ ok: true }))
const stopProcessWatch = vi.fn(async () => ({ ok: true }))
const unsubscribe = vi.fn()
let processUpdate: (() => void) | null = null

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
  processUpdate = null
  onProcessWatchUpdate.mockReset()
  onProcessWatchUpdate.mockImplementation((callback: () => void) => {
    processUpdate = callback
    return unsubscribe
  })
  startProcessWatch.mockClear()
  stopProcessWatch.mockClear()
  unsubscribe.mockClear()
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    getRunningGames,
    onProcessWatchUpdate,
    startProcessWatch,
    stopProcessWatch
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

/** Simula um push do agendador do main (10 s) e assenta a promessa do refresh. */
async function push(): Promise<void> {
  await act(async () => {
    processUpdate?.()
    await vi.advanceTimersByTimeAsync(0)
  })
}

describe('useGamesRunning', () => {
  it('assina o agendador único com 10 s em vez do timer próprio de 4 s', async () => {
    getRunningGames.mockResolvedValue({ ok: true, running: {} })
    render([game('a')])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(startProcessWatch).toHaveBeenCalledWith('games:running', 10000)
    expect(onProcessWatchUpdate).toHaveBeenCalledTimes(1)
  })

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
    await push()
    expect(ids()).toBe('')
  })

  it('falha na consulta mantém o último estado conhecido', async () => {
    getRunningGames.mockResolvedValue({ ok: true, running: { a: true } })
    render([game('a')])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    getRunningGames.mockRejectedValue(new Error('sem main'))
    await push()
    expect(ids()).toBe('a')
  })

  it('o push do agendador reconsulta e a lista nova rearma a assinatura', async () => {
    getRunningGames.mockResolvedValue({ ok: true, running: {} })
    render([game('a')])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(getRunningGames).toHaveBeenCalledTimes(1)

    await push()
    expect(getRunningGames).toHaveBeenCalledTimes(2)

    render([game('a'), game('b')])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(getRunningGames).toHaveBeenLastCalledWith(['a', 'b'])
    expect(stopProcessWatch).toHaveBeenCalledWith('games:running')
    expect(startProcessWatch).toHaveBeenLastCalledWith('games:running', 10000)
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

  it('desmontar remove a assinatura e para o consumidor (não consulta depois)', async () => {
    getRunningGames.mockResolvedValue({ ok: true, running: {} })
    render([game('a')])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const calls = getRunningGames.mock.calls.length

    act(() => root.unmount())
    mounted = false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000)
    })
    expect(getRunningGames).toHaveBeenCalledTimes(calls)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(stopProcessWatch).toHaveBeenCalledWith('games:running')
  })
})
