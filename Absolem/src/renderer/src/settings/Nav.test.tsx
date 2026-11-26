// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbsolemApi } from '../../../shared/ipc'
import { defaultTheme } from '../../../shared/theme'
import { SettingsApp } from './SettingsApp'

const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true

function makeApi(overrides: { lastSettingsTab?: string; configured?: boolean } = {}): {
  api: AbsolemApi
  storeSet: ReturnType<typeof vi.fn>
} {
  const storeSet = vi.fn(async () => ({ ok: true as const }))
  const storeGet = vi.fn(async (key: string) => {
    const values: Record<string, unknown> = {
      ui: {
        language: 'pt-BR',
        reducedMotion: false,
        startMinimized: false,
        lastSettingsTab: overrides.lastSettingsTab ?? 'appearance'
      },
      voice: {
        enabled: false,
        inputDeviceId: null,
        outputDeviceId: null,
        outputVolume: 1,
        maxSessionMinutes: 15,
        silenceTimeoutSeconds: 20,
        bargeIn: true,
        shortcut: 'Control+Alt+Space'
      },
      overlay: {
        visible: false,
        position: 'bottom-left',
        offsetX: 0,
        offsetY: 0,
        width: 320,
        height: 360,
        shortcut: 'Control+Alt+A',
        hideOnFullscreen: true
      },
      gemini: { model: 'gemini-2.0-flash', temperature: 0.7, monthlyTokenCap: 2_000_000 },
      memory: { enabled: true, autoExtract: true, lastConsolidationAt: null },
      web: { enabled: true },
      privacy: {
        telemetry: false,
        screen: { mode: 'off', blocklist: [], proactive: false }
      }
    }
    return { ok: true as const, key, value: values[key] }
  })
  const geminiStatus = vi.fn(async () => ({
    ok: true as const,
    status: {
      configured: overrides.configured ?? true,
      model: 'gemini-2.0-flash',
      lastError: null,
      disabledReason: null,
      usage: { today: 0, month: 0, cap: 2_000_000, percent: 0 }
    }
  }))
  const api = {
    themeGet: vi.fn(async () => ({ ok: true as const, theme: defaultTheme() })),
    themeSet: vi.fn(async () => ({ ok: true as const })),
    themeExport: vi.fn(async () => ({ ok: true as const, canceled: true })),
    themeImport: vi.fn(async () => ({
      ok: true as const,
      canceled: true,
      warnings: [] as string[]
    })),
    overlayStatus: vi.fn(async () => ({
      ok: true as const,
      status: {
        visible: false,
        interactive: false,
        autoHidden: false,
        layout: {
          position: 'bottom-left',
          offsetX: 0,
          offsetY: 0,
          width: 320,
          height: 360
        },
        shortcut: { registered: true, accelerator: 'Control+Alt+A' },
        hideOnFullscreen: true
      }
    })),
    overlaySetLayout: vi.fn(async () => api.overlayStatus()),
    storeGet,
    storeSet,
    gemini: { status: geminiStatus },
    voice: {
      status: vi.fn(async () => ({
        ok: true as const,
        status: {
          state: 'off',
          reason: null,
          consentGranted: false,
          sessionActive: false,
          inputDeviceId: null,
          outputDeviceId: null,
          outputVolume: 1
        }
      })),
      setDevice: vi.fn(),
      setConsent: vi.fn(),
      interrupt: vi.fn()
    },
    permissions: {
      get: vi.fn(async () => ({
        ok: true as const,
        permissions: {
          microphone: false,
          paused: false,
          categories: {
            'apps.launch': 'ask' as const,
            'apps.close': 'ask' as const,
            'files.read': 'ask' as const,
            'files.write': 'ask' as const,
            'system.power': 'deny' as const,
            'uia.control': 'deny' as const,
            'web.search': 'allow' as const
          }
        }
      })),
      set: vi.fn(async () => ({ ok: true as const }))
    },
    actions: {
      pause: vi.fn(async () => ({ ok: true as const, paused: false })),
      status: vi.fn()
    },
    memory: {
      list: vi.fn(async () => ({
        ok: true as const,
        memories: [],
        total: 0,
        hasMore: false,
        archived: [],
        maintenance: []
      })),
      stats: vi.fn(async () => ({
        ok: true as const,
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
      }))
    },
    history: { list: vi.fn(async () => ({ ok: true as const, enabled: true, turns: [] })) },
    getAppInfo: vi.fn(async () => ({
      ok: true as const,
      info: {
        name: 'Absolem',
        version: '0.1.0',
        platform: 'win32',
        electron: '28.0.0',
        chromium: '120.0.0',
        node: '18.0.0'
      }
    })),
    diagnostics: {
      gemini: vi.fn(async () => ({
        ok: true as const,
        diagnostics: {
          sdkPackage: '@google/genai',
          sdkVersion: '3.6.1',
          model: 'gemini-2.0-flash',
          promptVersion: '1.0.0',
          configured: true,
          lastError: null,
          usage: { today: 0, month: 0, cap: 2_000_000, percent: 0 }
        }
      })),
      overlay: vi.fn(async () => ({ ok: true as const, fps: 60 })),
      export: vi.fn(async () => ({ ok: true as const, canceled: true }))
    }
  }
  return { api: api as unknown as AbsolemApi, storeSet }
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function navButton(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('nav button')).find(
    (element) => element.textContent?.trim() === label
  )
  if (!found) throw new Error(`aba ausente: ${label}`)
  return found as HTMLButtonElement
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  window.location.hash = ''
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  window.location.hash = ''
})

describe('navegação das configurações', () => {
  it('troca de aba', async () => {
    const { api, storeSet } = makeApi()
    window.absolem = api
    await act(async () => {
      root.render(<SettingsApp />)
    })
    await settle()

    await act(async () => {
      navButton(container, 'Voz').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    expect(container.querySelector('main h2')?.textContent).toBe('Voz')
    expect(storeSet).toHaveBeenCalledWith(
      'ui',
      expect.objectContaining({ lastSettingsTab: 'voice' })
    )
  })

  it('aba desconhecida cai em Aparência', async () => {
    window.location.hash = '#settings/inexistente'
    const { api } = makeApi()
    window.absolem = api
    await act(async () => {
      root.render(<SettingsApp />)
    })
    await settle()

    expect(container.querySelector('main h2')?.textContent).toBe('Aparência')
  })

  it('estado persiste', async () => {
    const { api } = makeApi({ lastSettingsTab: 'permissions' })
    window.absolem = api
    await act(async () => {
      root.render(<SettingsApp />)
    })
    await settle()

    expect(container.querySelector('main h2')?.textContent).toBe('Permissões')
    expect(navButton(container, 'Permissões').getAttribute('aria-current')).toBe('page')
  })

  it('todas as abas montam sem erro', async () => {
    const { api } = makeApi()
    window.absolem = api
    await act(async () => {
      root.render(<SettingsApp />)
    })
    await settle()

    for (const label of [
      'Aparência',
      'Voz',
      'Permissões',
      'Memória',
      'Chave e custo',
      'Diagnóstico',
      'Sobre'
    ]) {
      await act(async () => {
        navButton(container, label).dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await settle()
      expect(container.querySelector('main')?.textContent?.trim().length ?? 0).toBeGreaterThan(0)
    }
  })
})
