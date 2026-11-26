// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import pkg from '../../../../package.json'
import type { AbsolemApi } from '../../../shared/ipc'
import { defaultTheme } from '../../../shared/theme'
import { ConversationLayer } from '../overlay/conversation/ConversationLayer'
import { SettingsApp } from './SettingsApp'

const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true

function makeApi(configured = true): AbsolemApi {
  const storeGet = vi.fn(async (key: string) => {
    const values: Record<string, unknown> = {
      ui: {
        language: 'pt-BR',
        reducedMotion: false,
        startMinimized: false,
        lastSettingsTab: 'appearance'
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
  const status = vi.fn(async () => ({
    ok: true as const,
    status: {
      configured,
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
    storeSet: vi.fn(async () => ({ ok: true as const })),
    gemini: { status },
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
        version: pkg.version,
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
          configured,
          lastError: null,
          usage: { today: 0, month: 0, cap: 2_000_000, percent: 0 }
        }
      })),
      overlay: vi.fn(async () => ({ ok: true as const, fps: 60 })),
      export: vi.fn(async () => ({ ok: true as const, canceled: true }))
    }
  }
  return api as unknown as AbsolemApi
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function navButton(container: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    (Array.from(container.querySelectorAll('nav button')).find(
      (element) => element.textContent?.trim() === label
    ) as HTMLButtonElement | undefined) ?? null
  )
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

describe('acessibilidade e primeira configuração', () => {
  it('todo input tem label', async () => {
    window.absolem = makeApi(true)
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
      const tab = navButton(container, label)
      if (!tab) throw new Error(`aba ausente: ${label}`)
      await act(async () => {
        tab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await settle()
      for (const control of Array.from(
        container.querySelectorAll<HTMLElement>('main input, main select, main textarea')
      )) {
        const id = control.getAttribute('id')
        const labelledBy = control.getAttribute('aria-labelledby')
        const ariaLabel = control.getAttribute('aria-label')
        const wrapped = control.closest('label') !== null
        const byFor = id ? container.querySelector(`label[for="${id}"]`) !== null : false
        expect(
          Boolean(labelledBy || ariaLabel || wrapped || byFor),
          `controle sem rótulo na aba ${label}: ${control.outerHTML.slice(0, 120)}`
        ).toBe(true)
      }
    }
  })

  it('aria-live presente no status', async () => {
    const api = {
      onDelta: () => () => undefined,
      cancel: vi.fn(async () => ({ ok: true as const })),
      interrupt: vi.fn(async () => ({ ok: true as const }))
    }
    await act(async () => {
      root.render(<ConversationLayer voiceState="listening" api={api} />)
    })
    const status = container.querySelector('[role="status"]')
    expect(status?.getAttribute('aria-live')).toBe('polite')
  })

  it('foco inicial na aba ativa', async () => {
    window.absolem = makeApi(true)
    await act(async () => {
      root.render(<SettingsApp />)
    })
    await settle()

    const active = container.querySelector('nav button[aria-current="page"]')
    expect(active).not.toBeNull()
    expect(document.activeElement).toBe(active)
  })

  it('sem chave abre na aba Chave', async () => {
    window.absolem = makeApi(false)
    await act(async () => {
      root.render(<SettingsApp />)
    })
    await settle()

    expect(container.querySelector('main h2')?.textContent).toBe('Chave e custo')
  })
})
