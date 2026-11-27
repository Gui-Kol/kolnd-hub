// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AboutTab } from './AboutTab'

const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true

function makeApi(version: string): {
  appInfo: ReturnType<typeof vi.fn>
  relaunch: ReturnType<typeof vi.fn>
} {
  return {
    appInfo: vi.fn(async () => ({
      ok: true as const,
      info: { name: 'Absolem', version, platform: 'win32' }
    })),
    relaunch: vi.fn(async () => ({ ok: true as const }))
  }
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

describe('AboutTab (versão da Hub)', () => {
  it('mostra a versão do Kolnd Hub injetada e não uma versão própria', async () => {
    await act(async () => {
      root.render(<AboutTab api={makeApi('1.2.2')} />)
    })
    await settle()

    expect(container.textContent).toContain('Versão do Kolnd Hub')
    expect(container.textContent).toContain('1.2.2')
    expect(container.textContent).toContain('Atualizado junto com o Kolnd Hub')
    expect(container.querySelector('[data-app-version]')?.getAttribute('data-app-version')).toBe(
      '1.2.2'
    )
  })

  it('sem versão disponível exibe —', async () => {
    await act(async () => {
      root.render(<AboutTab api={makeApi('')} />)
    })
    await settle()

    expect(container.textContent).toContain('Versão do Kolnd Hub')
    expect(container.textContent).toContain('—')
  })

  it('confirma e chama o relaunch do Absolem', async () => {
    const api = makeApi('1.2.2')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => {
      root.render(<AboutTab api={api} />)
    })
    await settle()
    const button = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent === 'Reiniciar Absolem'
    )
    if (!button) throw new Error('botão de reinício ausente')
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()
    expect(confirm).toHaveBeenCalled()
    expect(api.relaunch).toHaveBeenCalledTimes(1)
    confirm.mockRestore()
  })

  it('exibe falha do relaunch', async () => {
    const api = makeApi('1.2.2')
    api.relaunch.mockResolvedValue({ ok: false, error: 'falha de teste' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => {
      root.render(<AboutTab api={api} />)
    })
    await settle()
    const button = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent === 'Reiniciar Absolem'
    )
    if (!button) throw new Error('botão de reinício ausente')
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()
    expect(container.textContent).toContain('falha de teste')
    vi.restoreAllMocks()
  })
})
