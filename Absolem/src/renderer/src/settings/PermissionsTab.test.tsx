// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionsState } from '../../../shared/permissions'
import { PermissionsTab, type PermissionsTabApi } from './PermissionsTab'

const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true

function permissions(): PermissionsState {
  return {
    microphone: false,
    paused: false,
    categories: {
      'apps.launch': 'ask',
      'apps.close': 'ask',
      'files.read': 'ask',
      'files.write': 'ask',
      'system.power': 'deny',
      'uia.control': 'deny',
      'web.search': 'allow'
    }
  }
}

function makeApi(): {
  api: PermissionsTabApi
  setPermission: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  setPrivacy: ReturnType<typeof vi.fn>
} {
  const setPermission = vi.fn(async () => ({ ok: true as const }))
  const pause = vi.fn(async () => ({ ok: true as const, paused: true }))
  const setPrivacy = vi.fn(async () => ({ ok: true as const }))
  const api: PermissionsTabApi = {
    getPermissions: vi.fn(async () => ({ ok: true as const, permissions: permissions() })),
    setPermission,
    pause,
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
    setPrivacy,
    openAudit: vi.fn(async () => ({ ok: true as const }))
  }
  return { api, setPermission, pause, setPrivacy }
}

function setSelect(element: HTMLSelectElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
  descriptor?.set?.call(element, value)
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

function setInput(element: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
  descriptor?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
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

describe('aba Permissões', () => {
  it('mudança simples salva', async () => {
    const { api, setPermission } = makeApi()
    await act(async () => {
      root.render(<PermissionsTab api={api} />)
    })
    await settle()

    const select = container.querySelector<HTMLSelectElement>('#permission-files-read')
    if (!select) throw new Error('select ausente')
    await act(async () => {
      setSelect(select, 'allow')
    })
    await settle()

    expect(setPermission).toHaveBeenCalledWith('files.read', 'allow')
  })

  it('allow em power pede confirmação', async () => {
    const { api, setPermission } = makeApi()
    await act(async () => {
      root.render(<PermissionsTab api={api} />)
    })
    await settle()

    const select = container.querySelector<HTMLSelectElement>('#permission-system-power')
    if (!select) throw new Error('select ausente')
    await act(async () => {
      setSelect(select, 'allow')
    })
    expect(setPermission).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Permitir')

    await act(async () => {
      button(container, 'Confirmar permissão').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    await settle()
    expect(setPermission).toHaveBeenCalledWith('system.power', 'allow')
  })

  it('pausa reflete no store', async () => {
    const { api, pause } = makeApi()
    await act(async () => {
      root.render(<PermissionsTab api={api} />)
    })
    await settle()

    const checkbox = container.querySelector<HTMLInputElement>('#permissions-paused')
    if (!checkbox) throw new Error('checkbox ausente')
    await act(async () => {
      checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    expect(pause).toHaveBeenCalledWith(true)
  })

  it('blocklist adiciona e remove linha', async () => {
    const { api, setPrivacy } = makeApi()
    await act(async () => {
      root.render(<PermissionsTab api={api} />)
    })
    await settle()

    const input = container.querySelector<HTMLInputElement>('#permissions-blocklist-input')
    if (!input) throw new Error('input ausente')
    await act(async () => {
      setInput(input, 'banco-x')
    })
    await act(async () => {
      button(container, 'Adicionar').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    expect(setPrivacy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        screen: expect.objectContaining({ blocklist: ['banco-x'] })
      })
    )
    expect(container.querySelectorAll('[data-blocklist-entry]')).toHaveLength(1)

    const remove = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remover banco-x"]'
    )
    if (!remove) throw new Error('botão remover ausente')
    await act(async () => {
      remove.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    expect(setPrivacy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        screen: expect.objectContaining({ blocklist: [] })
      })
    )
  })
})
