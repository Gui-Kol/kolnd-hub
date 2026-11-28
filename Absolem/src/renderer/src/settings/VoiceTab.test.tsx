// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceConfig } from '../../../shared/config'
import type { VoiceStatus } from '../../../shared/voice'
import { VoiceTab, type VoiceTabApi } from './VoiceTab'

const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true

function voiceConfig(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    enabled: false,
    inputDeviceId: null,
    outputDeviceId: null,
    outputVolume: 1,
    maxSessionMinutes: 15,
    silenceTimeoutSeconds: 20,
    bargeIn: true,
    shortcut: 'Control+Alt+Space',
    ...overrides
  }
}

function voiceStatus(overrides: Partial<VoiceStatus> = {}): VoiceStatus {
  return {
    state: 'off',
    reason: null,
    consentGranted: false,
    sessionActive: false,
    inputDeviceId: null,
    outputDeviceId: null,
    outputVolume: 1,
    ...overrides
  }
}

function makeApi(config = voiceConfig()): {
  api: VoiceTabApi
  setDevice: ReturnType<typeof vi.fn>
  setVoiceConfig: ReturnType<typeof vi.fn>
  setConsent: ReturnType<typeof vi.fn>
  setOverlayShortcut: ReturnType<typeof vi.fn>
  probeMicrophone: ReturnType<typeof vi.fn>
} {
  const setDevice = vi.fn(async () => ({ ok: true as const, status: voiceStatus() }))
  const setVoiceConfig = vi.fn(async () => ({ ok: true as const }))
  const setConsent = vi.fn(async () => ({ ok: true as const, status: voiceStatus() }))
  const setOverlayShortcut = vi.fn(async (shortcut: string) => ({
    ok: true as const,
    status: {
      visible: true,
      interactive: false,
      autoHidden: false,
      layout: { position: 'bottom-left' as const, offsetX: 0, offsetY: 0, width: 320, height: 360 },
      shortcut: { registered: true, accelerator: shortcut },
      hideOnFullscreen: false
    }
  }))
  const probeMicrophone = vi.fn(async (onLevel: (level: number) => void) => {
    onLevel(0.5)
  })
  const api: VoiceTabApi = {
    getVoiceConfig: vi.fn(async () => ({
      ok: true as const,
      key: 'voice' as const,
      value: config
    })),
    setVoiceConfig,
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
    setOverlayShortcut,
    status: vi.fn(async () => ({ ok: true as const, status: voiceStatus() })),
    setDevice,
    setConsent,
    listDevices: vi.fn(async () => [
      { id: 'mic-1', label: 'Microfone fake', kind: 'audioinput' as const },
      { id: 'out-1', label: 'Saída fake', kind: 'audiooutput' as const }
    ]),
    probeMicrophone
  }
  return { api, setDevice, setVoiceConfig, setConsent, setOverlayShortcut, probeMicrophone }
}

function setValue(
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
  eventName: 'input' | 'change' = 'input'
): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
  descriptor?.set?.call(element, value)
  element.dispatchEvent(new Event(eventName, { bubbles: true }))
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

describe('aba Voz', () => {
  it('salva dispositivo', async () => {
    const { api, setDevice } = makeApi()
    await act(async () => {
      root.render(<VoiceTab api={api} />)
    })
    await settle()

    const select = container.querySelector<HTMLSelectElement>('#voice-input-device')
    if (!select) throw new Error('select de microfone ausente')
    await act(async () => {
      setValue(select, 'mic-1', 'change')
    })
    await settle()

    expect(setDevice).toHaveBeenCalledWith({ inputDeviceId: 'mic-1' })
  })

  it('limite fora da faixa é corrigido', async () => {
    const { api, setVoiceConfig } = makeApi()
    await act(async () => {
      root.render(<VoiceTab api={api} />)
    })
    await settle()

    const input = container.querySelector<HTMLInputElement>('#voice-max-minutes')
    if (!input) throw new Error('limite ausente')
    await act(async () => {
      setValue(input, '60')
    })
    await act(async () => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    await settle()

    expect(setVoiceConfig).toHaveBeenCalledWith(expect.objectContaining({ maxSessionMinutes: 30 }))
  })

  it('revogar limpa consentimento', async () => {
    const { api, setConsent } = makeApi()
    await act(async () => {
      root.render(<VoiceTab api={api} />)
    })
    await settle()

    const button = Array.from(container.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('Revogar consentimento')
    )
    if (!button) throw new Error('botão revogar ausente')
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    expect(setConsent).toHaveBeenCalledWith(false)
  })

  it('teste de microfone não chama o Gemini', async () => {
    const { api, probeMicrophone } = makeApi()
    await act(async () => {
      root.render(<VoiceTab api={api} />)
    })
    await settle()

    const button = Array.from(container.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('Testar microfone')
    )
    if (!button) throw new Error('botão testar ausente')
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    expect(probeMicrophone).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('0.5')
    expect('gemini' in api).toBe(false)
    expect('chat' in api).toBe(false)
  })

  it('atalho do overlay aplica pelo canal dedicado', async () => {
    const { api, setOverlayShortcut } = makeApi()
    await act(async () => {
      root.render(<VoiceTab api={api} />)
    })
    await settle()

    const input = container.querySelector<HTMLInputElement>('#voice-overlay-shortcut')
    if (!input) throw new Error('campo do atalho do overlay ausente')
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'K', ctrlKey: true, shiftKey: true, bubbles: true })
      )
    })
    await settle()

    expect(setOverlayShortcut).toHaveBeenCalledWith('Control+Shift+K')
    expect(input.value).toBe('Control+Shift+K')
    expect(container.textContent).toContain('aplicado imediatamente')
  })
})
