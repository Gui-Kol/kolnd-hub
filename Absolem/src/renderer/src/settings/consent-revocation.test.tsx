// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeminiConfig } from '../../../shared/config'
import type { GeminiStatusResult, MemoryListResult, MemoryStatsResult } from '../../../shared/ipc'
import type { PermissionsState } from '../../../shared/permissions'
import { effectivePermission } from '../../../shared/permissions'
import type { PrivacyScreenConfig } from '../../../shared/screen'
import { normalizePrivacyScreenConfig } from '../../../shared/screen'
import { KeyTab, type KeyTabApi } from './KeyTab'
import { PermissionsTab, type PermissionsTabApi } from './PermissionsTab'
import { VoiceTab, type VoiceTabApi } from './VoiceTab'
import { MemoryPanel, type MemoryPanelApi } from './memory/MemoryPanel'

const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true

function permissionsAllAllowed(): PermissionsState {
  return {
    microphone: true,
    paused: false,
    categories: {
      'apps.launch': 'allow',
      'apps.close': 'allow',
      'files.read': 'allow',
      'files.write': 'allow',
      'system.power': 'allow',
      'uia.control': 'allow',
      'web.search': 'allow'
    }
  }
}

function setSelect(element: HTMLSelectElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
  descriptor?.set?.call(element, value)
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

function setCheckbox(element: HTMLInputElement, checked: boolean): void {
  if (element.checked !== checked) {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === label
  )
  if (!found) throw new Error(`botão ausente: ${label}`)
  return found as HTMLButtonElement
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

describe('consentimentos e revogação', () => {
  it('microfone: revoga em um clique e a permissão fica negada', async () => {
    let state = permissionsAllAllowed()
    const setConsent = vi.fn(async (granted: boolean) => {
      state = { ...state, microphone: granted }
      return {
        ok: true as const,
        status: {
          state: granted ? ('listening' as const) : ('error' as const),
          reason: granted ? null : 'consentDenied',
          consentGranted: granted,
          sessionActive: granted,
          inputDeviceId: null,
          outputDeviceId: null,
          outputVolume: 1
        }
      }
    })
    const api: VoiceTabApi = {
      getVoiceConfig: vi.fn(async () => ({
        ok: true as const,
        key: 'voice' as const,
        value: {
          enabled: true,
          inputDeviceId: null,
          outputDeviceId: null,
          outputVolume: 1,
          maxSessionMinutes: 15,
          silenceTimeoutSeconds: 20,
          bargeIn: true,
          shortcut: 'Control+Alt+Space'
        }
      })),
      setVoiceConfig: vi.fn(async () => ({ ok: true as const })),
      getOverlayConfig: vi.fn(async () => ({
        ok: true as const,
        key: 'overlay' as const,
        value: {
          visible: false,
          position: 'bottom-left',
          offsetX: 0,
          offsetY: 0,
          width: 320,
          height: 360,
          shortcut: 'Control+Alt+A',
          hideOnFullscreen: true
        }
      })),
      setOverlayShortcut: vi.fn(async () => ({
        ok: false as const,
        error: 'não usado neste teste'
      })),
      status: vi.fn(async () => ({
        ok: true as const,
        status: {
          state: 'listening' as const,
          reason: null,
          consentGranted: true,
          sessionActive: true,
          inputDeviceId: null,
          outputDeviceId: null,
          outputVolume: 1
        }
      })),
      setDevice: vi.fn(),
      setConsent
    }

    await act(async () => {
      root.render(<VoiceTab api={api} />)
    })
    await settle()

    expect(container.textContent).toContain('consentido')
    await act(async () => {
      button(container, 'Revogar consentimento de microfone').click()
    })
    await settle()

    expect(setConsent).toHaveBeenCalledTimes(1)
    expect(setConsent).toHaveBeenCalledWith(false)
    expect(container.textContent).toContain('não consentido')
    // A ferramenta de voz consulta `permissions.microphone` a cada início.
    expect(state.microphone).toBe(false)
  })

  it('tela: desliga no seletor em um clique e o modo fica off', async () => {
    const setPrivacy = vi.fn(
      async (_value: { telemetry: boolean; screen: PrivacyScreenConfig }) => ({ ok: true as const })
    )
    const api: PermissionsTabApi = {
      getPermissions: vi.fn(async () => ({
        ok: true as const,
        permissions: permissionsAllAllowed()
      })),
      setPermission: vi.fn(async () => ({ ok: true as const })),
      pause: vi.fn(async () => ({ ok: true as const, paused: false })),
      getWeb: vi.fn(async () => ({
        ok: true as const,
        key: 'web' as const,
        value: { enabled: true }
      })),
      setWeb: vi.fn(async () => ({ ok: true as const })),
      getPrivacy: vi.fn(async () => ({
        ok: true as const,
        key: 'privacy' as const,
        value: {
          telemetry: false,
          screen: { mode: 'on' as const, blocklist: [], proactive: false }
        }
      })),
      setPrivacy,
      openAudit: vi.fn(async () => ({ ok: true as const }))
    }

    await act(async () => {
      root.render(<PermissionsTab api={api} />)
    })
    await settle()

    const select = container.querySelector<HTMLSelectElement>('#permissions-screen-mode')
    if (!select) throw new Error('seletor de tela ausente')
    expect(select.value).toBe('on')
    await act(async () => {
      setSelect(select, 'off')
    })
    await settle()

    expect(setPrivacy).toHaveBeenCalled()
    const last = setPrivacy.mock.calls.at(-1)?.[0] as {
      telemetry: boolean
      screen: PrivacyScreenConfig
    }
    expect(normalizePrivacyScreenConfig(last.screen).mode).toBe('off')
  })

  it('categorias de ação: negar em um clique bloqueia a ferramenta', async () => {
    let state = permissionsAllAllowed()
    const setPermission = vi.fn(async (category: keyof PermissionsState['categories']) => {
      state = {
        ...state,
        categories: { ...state.categories, [category]: 'deny' as const }
      }
      return { ok: true as const }
    })
    const api: PermissionsTabApi = {
      getPermissions: vi.fn(async () => ({ ok: true as const, permissions: state })),
      setPermission,
      pause: vi.fn(async () => ({ ok: true as const, paused: false })),
      getWeb: vi.fn(async () => ({
        ok: true as const,
        key: 'web' as const,
        value: { enabled: true }
      })),
      setWeb: vi.fn(async () => ({ ok: true as const })),
      getPrivacy: vi.fn(async () => ({
        ok: true as const,
        key: 'privacy' as const,
        value: { telemetry: false, screen: { mode: 'off', blocklist: [], proactive: false } }
      })),
      setPrivacy: vi.fn(async () => ({ ok: true as const })),
      openAudit: vi.fn(async () => ({ ok: true as const }))
    }

    await act(async () => {
      root.render(<PermissionsTab api={api} />)
    })
    await settle()

    const categories = [
      'apps.launch',
      'apps.close',
      'files.read',
      'files.write',
      'system.power',
      'uia.control',
      'web.search'
    ] as const
    for (const category of categories) {
      const id = `permission-${category.replace(/\./g, '-')}`
      const select = container.querySelector<HTMLSelectElement>(`#${id}`)
      if (!select) throw new Error(`seletor ausente: ${id}`)
      await act(async () => {
        setSelect(select, 'deny')
      })
      await settle()
      expect(setPermission).toHaveBeenLastCalledWith(category, 'deny')
      expect(effectivePermission(state, category)).toBe('deny')
    }

    const pause = container.querySelector<HTMLInputElement>('#permissions-paused')
    if (!pause) throw new Error('pausa ausente')
    await act(async () => {
      setCheckbox(pause, true)
    })
    await settle()
    expect(api.pause).toHaveBeenCalledWith(true)
  })

  it('pesquisa web: desmarcar o checkbox remove a ferramenta em um clique', async () => {
    const setWeb = vi.fn(async (_value: { enabled: boolean }) => ({ ok: true as const }))
    const api: PermissionsTabApi = {
      getPermissions: vi.fn(async () => ({
        ok: true as const,
        permissions: permissionsAllAllowed()
      })),
      setPermission: vi.fn(async () => ({ ok: true as const })),
      pause: vi.fn(async () => ({ ok: true as const, paused: false })),
      getWeb: vi.fn(async () => ({
        ok: true as const,
        key: 'web' as const,
        value: { enabled: true }
      })),
      setWeb,
      getPrivacy: vi.fn(async () => ({
        ok: true as const,
        key: 'privacy' as const,
        value: { telemetry: false, screen: { mode: 'off', blocklist: [], proactive: false } }
      })),
      setPrivacy: vi.fn(async () => ({ ok: true as const })),
      openAudit: vi.fn(async () => ({ ok: true as const }))
    }

    await act(async () => {
      root.render(<PermissionsTab api={api} />)
    })
    await settle()

    const web = container.querySelector<HTMLInputElement>('#permissions-web')
    if (!web) throw new Error('checkbox de pesquisa ausente')
    await act(async () => {
      setCheckbox(web, false)
    })
    await settle()
    expect(setWeb).toHaveBeenLastCalledWith({ enabled: false })
  })

  it('memória: pausar em um clique desliga extração e recuperação', async () => {
    const storeSet = vi.fn(async () => ({ ok: true as const }))
    const emptyList: MemoryListResult = {
      ok: true,
      memories: [],
      total: 0,
      hasMore: false,
      archived: [],
      maintenance: []
    }
    const emptyStats: MemoryStatsResult = {
      ok: true,
      stats: {
        total: 0,
        byKind: { fact: 0, preference: 0, profile: 0, temporary: 0 },
        oldest: null,
        newest: null,
        pinned: 0,
        approxBytes: 0,
        lastExtractionAt: null,
        lastConsolidationAt: null,
        maintenance: []
      }
    }
    const api: MemoryPanelApi = {
      list: vi.fn(async () => emptyList),
      search: vi.fn(async () => ({ ok: true as const, memories: [] })),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      removeAll: vi.fn(),
      stats: vi.fn(async () => emptyStats),
      export: vi.fn(),
      import: vi.fn(),
      storeGet: vi.fn(async () => ({
        ok: true as const,
        key: 'memory' as const,
        value: { enabled: true, autoExtract: true, lastConsolidationAt: null }
      })),
      storeSet
    }

    await act(async () => {
      root.render(<MemoryPanel api={api} />)
    })
    await settle()

    const enabled = container.querySelector<HTMLInputElement>('#memory-enabled')
    if (!enabled) throw new Error('checkbox da memória ausente')
    await act(async () => {
      setCheckbox(enabled, false)
    })
    await settle()

    expect(storeSet).toHaveBeenLastCalledWith('memory', {
      enabled: false,
      autoExtract: true,
      lastConsolidationAt: null,
      note: ''
    })
  })

  it('chave: remover exige dois cliques e deixa o app sem chave', async () => {
    let configured = true
    const clearKey = vi.fn(async () => {
      configured = false
      return { ok: true as const }
    })
    const api: KeyTabApi = {
      status: vi.fn(async (): Promise<GeminiStatusResult> => ({
        ok: true,
        status: {
          configured,
          model: 'gemini-2.0-flash',
          lastError: null,
          disabledReason: configured ? null : 'Chave do Gemini não configurada.',
          usage: { today: 0, month: 0, cap: 2_000_000, percent: 0 }
        }
      })),
      setKey: vi.fn(async () => ({ ok: true as const })),
      clearKey,
      testKey: vi.fn(),
      getGeminiConfig: vi.fn(async () => ({
        ok: true as const,
        key: 'gemini' as const,
        value: {
          model: 'gemini-2.0-flash',
          liveModel: 'gemini-3.8-live',
          temperature: 0.7,
          monthlyTokenCap: 2_000_000
        } satisfies GeminiConfig
      })),
      setGeminiConfig: vi.fn(async () => ({ ok: true as const }))
    }

    await act(async () => {
      root.render(<KeyTab api={api} />)
    })
    await settle()

    await act(async () => {
      button(container, 'Remover chave').click()
    })
    await settle()
    expect(container.textContent).toContain('Remover a chave?')

    await act(async () => {
      button(container, 'Confirmar remoção').click()
    })
    await settle()

    expect(clearKey).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('não configurada')
  })
})
