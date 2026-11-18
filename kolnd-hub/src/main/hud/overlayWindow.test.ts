import { describe, expect, it, vi } from 'vitest'

// O módulo importa o Electron real (janela da sobreposição), mas `computeHudBounds`
// é pura — os mocks mínimos bastam para importar no ambiente node do vitest.
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  screen: { getPrimaryDisplay: vi.fn() }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { computeHudBounds } from './overlayWindow'

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 }

describe('computeHudBounds', () => {
  it('posiciona no canto superior esquerdo com margem de 12 px', () => {
    expect(computeHudBounds({ x: 100, y: -50, width: 1920, height: 1040 }, 300, 400)).toEqual({
      x: 112,
      y: -38,
      width: 300,
      height: 400
    })
  })

  it('normaliza a largura (passo de 10 e clamp 180–560)', () => {
    expect(computeHudBounds(WORK_AREA, 433, 400).width).toBe(430)
    expect(computeHudBounds(WORK_AREA, 9999, 400).width).toBe(560)
    expect(computeHudBounds(WORK_AREA, 50, 400).width).toBe(180)
  })

  it('normaliza a altura medida', () => {
    expect(computeHudBounds(WORK_AREA, 300, 300.2).height).toBe(301)
    expect(computeHudBounds(WORK_AREA, 300, 50).height).toBe(120)
    expect(computeHudBounds(WORK_AREA, 300, Number.NaN).height).toBe(240)
  })

  it('mantém a altura medida quando ela cabe na área de trabalho', () => {
    expect(computeHudBounds(WORK_AREA, 300, 888).height).toBe(888)
  })

  it('não passa da área de trabalho (1200 em 1040 → 1016)', () => {
    expect(computeHudBounds(WORK_AREA, 300, 1200).height).toBe(1016)
    expect(computeHudBounds(WORK_AREA, 300, 5000).height).toBe(1016)
  })

  it('respeita o piso mínimo em área de trabalho minúscula', () => {
    expect(computeHudBounds({ x: 0, y: 0, width: 800, height: 100 }, 300, 888).height).toBe(120)
  })
})
