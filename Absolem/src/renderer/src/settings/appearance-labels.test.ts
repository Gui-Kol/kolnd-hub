// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultTheme } from '../../../shared/theme'
import { AppearanceTab } from './AppearanceTab'

/**
 * Contrato de rótulos da aba Aparência (task 21, T5).
 *
 * Cada controle novo precisa de `<label htmlFor>` em pt-BR, sem expor id
 * interno, e o seletor de acabamento tem exatamente as duas opções do tema.
 */

const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function renderTab(): void {
  act(() => {
    root.render(
      createElement(AppearanceTab, {
        theme: defaultTheme(),
        layout: {
          position: 'bottom-left',
          offsetX: 0,
          offsetY: 0,
          width: 320,
          height: 360
        },
        onThemeChange: vi.fn(),
        onPreset: vi.fn(),
        onResetTheme: vi.fn(),
        onLayoutChange: vi.fn(),
        onResetLayout: vi.fn()
      })
    )
  })
}

const NEW_FIELD_IDS = [
  'appearance-look',
  'appearance-belly-color',
  'appearance-detail-color',
  'appearance-outline'
]

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

describe('rótulos da aba Aparência', () => {
  it('todo campo novo tem rótulo', () => {
    renderTab()

    for (const id of NEW_FIELD_IDS) {
      expect(container.querySelector(`#${id}`), `controle ausente: ${id}`).not.toBeNull()
      const label = container.querySelector(`label[for="${id}"]`)
      expect(label?.textContent?.trim(), `rótulo ausente: ${id}`).toBeTruthy()
    }
  })

  it('nenhum rótulo mostra id interno', () => {
    renderTab()

    const labels = Array.from(container.querySelectorAll('label'))
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) {
      const text = label.textContent ?? ''
      expect(text).not.toMatch(/appearance-/)
      expect(text).not.toMatch(/bellyColor|detailColor|outlineStrength|presetId/)
      expect(text).not.toMatch(/\bholo\b|\bstorybook\b/)
    }
  })

  it('o seletor de acabamento tem exatamente 2 opções', () => {
    renderTab()

    const select = container.querySelector<HTMLSelectElement>('#appearance-look')
    if (!select) throw new Error('seletor de acabamento ausente')
    const options = Array.from(select.options)
    expect(options).toHaveLength(2)
    expect(options.map((option) => option.value)).toEqual(['holo', 'storybook'])
    expect(options.map((option) => option.textContent?.trim())).toEqual(['Holofote', 'Ilustração'])
  })
})
