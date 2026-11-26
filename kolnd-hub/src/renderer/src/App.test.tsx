// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import App from './App'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  processUpdate: null as
    null | ((processes: Array<{ name: string; id: number; path: string }>) => void),
  unsubscribeProcess: vi.fn(),
  onProcessWatchUpdate: vi.fn(),
  startProcessWatch: vi.fn(async () => ({ ok: true })),
  stopProcessWatch: vi.fn(async () => ({ ok: true })),
  systemRunningProcesses: vi.fn(async () => []),
  onStatusChanged: vi.fn(() => vi.fn()),
  logPageView: vi.fn(async () => ({ success: true })),
  checkForUpdates: vi.fn(async () => ({
    ok: false,
    release: null,
    updateAvailable: false,
    canAutoInstall: false
  })),
  kloudGamesStatus: vi.fn(async () => ({
    installed: true,
    exePath: null,
    msiPath: null,
    dir: '',
    running: false
  })),
  getAllStatus: vi.fn(async () => ({})),
  systemPcName: vi.fn(async () => 'PC-TESTE'),
  startupList: vi.fn(async () => []),
  getLaunchKloudOnStart: vi.fn(async () => false)
}))

vi.mock('./components/Layout', async () => {
  const React = await import('react')
  return {
    Layout: ({ children }: { children?: ReactNode }) => React.createElement('div', null, children)
  }
})
vi.mock('./components/Dashboard', async () => {
  const React = await import('react')
  return { Dashboard: () => React.createElement('div', { 'data-testid': 'dashboard' }) }
})
vi.mock('./components/LoadingScreen', async () => {
  const React = await import('react')
  return { LoadingScreen: () => React.createElement('div', null, 'carregando') }
})
vi.mock('./components/ErrorBoundary', async () => {
  const React = await import('react')
  return {
    ErrorBoundary: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children)
  }
})
vi.mock('framer-motion', async () => {
  const React = await import('react')
  const passthrough = ({ children }: { children?: ReactNode }) =>
    React.createElement(React.Fragment, null, children)
  return { AnimatePresence: passthrough, motion: { div: passthrough } }
})
vi.mock('./lib/motion', () => ({ useReducedMotion: () => true }))
vi.mock('./hooks/useGuideButtonShortcut', () => ({ useGuideButtonShortcut: () => undefined }))
vi.mock('./lib/hubConfig', () => ({
  loadAppConfigs: vi.fn(async () => []),
  saveAppConfigs: vi.fn(async () => undefined),
  loadImportanceMap: vi.fn(async () => ({}))
}))

let container: HTMLDivElement
let root: Root
let mounted: boolean
let visibility: DocumentVisibilityState

beforeEach(() => {
  vi.clearAllMocks()
  mocks.processUpdate = null
  mocks.onProcessWatchUpdate.mockImplementation((callback) => {
    mocks.processUpdate = callback
    return mocks.unsubscribeProcess
  })
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    onProcessWatchUpdate: mocks.onProcessWatchUpdate,
    startProcessWatch: mocks.startProcessWatch,
    stopProcessWatch: mocks.stopProcessWatch,
    systemRunningProcesses: mocks.systemRunningProcesses,
    onStatusChanged: mocks.onStatusChanged,
    logPageView: mocks.logPageView,
    checkForUpdates: mocks.checkForUpdates,
    kloudGamesStatus: mocks.kloudGamesStatus,
    getAllStatus: mocks.getAllStatus,
    systemPcName: mocks.systemPcName,
    startupList: mocks.startupList,
    getLaunchKloudOnStart: mocks.getLaunchKloudOnStart
  }
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mounted = true
})

afterEach(() => {
  if (mounted) act(() => root.unmount())
  container.remove()
  delete (window as unknown as { api?: unknown }).api
})

describe('App — consumidor do agendador de processos', () => {
  it('assina uma única vez com 15 s e limpa no unmount', async () => {
    await act(async () => {
      root.render(<App />)
    })

    expect(mocks.onProcessWatchUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.startProcessWatch).toHaveBeenCalledTimes(1)
    expect(mocks.startProcessWatch).toHaveBeenCalledWith('app:background-processes', 15000)
    expect(mocks.systemRunningProcesses).not.toHaveBeenCalled()

    act(() => root.unmount())
    mounted = false

    expect(mocks.unsubscribeProcess).toHaveBeenCalledTimes(1)
    expect(mocks.stopProcessWatch).toHaveBeenCalledWith('app:background-processes')
  })

  it('re-registra no visibilitychange sem criar nova assinatura', async () => {
    await act(async () => {
      root.render(<App />)
    })

    visibility = 'hidden'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(mocks.startProcessWatch).toHaveBeenLastCalledWith('app:background-processes', 60000)

    visibility = 'visible'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(mocks.startProcessWatch).toHaveBeenLastCalledWith('app:background-processes', 15000)
    expect(mocks.startProcessWatch).toHaveBeenCalledTimes(3)
    expect(mocks.onProcessWatchUpdate).toHaveBeenCalledTimes(1)
  })

  it('recebe o push do main e atualiza o estado sem consultar systemRunningProcesses', async () => {
    await act(async () => {
      root.render(<App />)
    })

    act(() => {
      mocks.processUpdate?.([{ name: 'steam', id: 10, path: 'C:\\Steam\\steam.exe' }])
    })

    expect(mocks.processUpdate).toBeTypeOf('function')
    expect(mocks.systemRunningProcesses).not.toHaveBeenCalled()
  })
})
