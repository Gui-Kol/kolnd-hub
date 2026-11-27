import { describe, expect, it, vi } from 'vitest'
import { applyThemeChange, outlinePresenceChanged, themeRequiresMeshRebuild } from './sceneTheme'
import type { ApplyThemeChangeContext, ThemeRebuildInput } from './sceneTheme'

function ctx(overrides: Partial<ApplyThemeChangeContext> = {}): ApplyThemeChangeContext {
  return {
    rebuildCaterpillar: vi.fn(),
    rebuildOutline: vi.fn(),
    syncMaterialColors: vi.fn(),
    outlineStrength: 0.7,
    ...overrides
  }
}

const base: ThemeRebuildInput = { style: 'classic', outfit: 'none', accessories: [] }

describe('applyThemeChange (task 19, T6)', () => {
  it('mudar só a cor não reconstrói a malha', () => {
    const rebuildCaterpillar = vi.fn()
    const syncMaterialColors = vi.fn()
    const rebuildOutline = vi.fn()
    const context = ctx({ rebuildCaterpillar, syncMaterialColors, rebuildOutline })

    // Mesmo estilo/roupa/acessórios; só a cor (fora deste recorte) muda.
    const result = applyThemeChange(base, { ...base }, context)

    expect(rebuildCaterpillar).not.toHaveBeenCalled()
    expect(syncMaterialColors).toHaveBeenCalledTimes(1)
    expect(result.rebuiltMesh).toBe(false)
    // Sem mudança de força/presença de contorno, contorno não reconstrói.
    expect(rebuildOutline).not.toHaveBeenCalled()
  })

  it('mudar outlineStrength de 0 para >0 reconstrói o contorno', () => {
    const rebuildCaterpillar = vi.fn()
    const rebuildOutline = vi.fn()
    const context = ctx({ rebuildCaterpillar, rebuildOutline, outlineStrength: 0 })

    const result = applyThemeChange(base, { ...base }, context, 0.7)

    // Contorno reconstrói...
    expect(rebuildOutline).toHaveBeenCalledTimes(1)
    expect(result.rebuiltOutline).toBe(true)
    expect(result.outlinePresenceChanged).toBe(true)
    // ...mas a malha NÃO é recriada.
    expect(rebuildCaterpillar).not.toHaveBeenCalled()
    expect(result.rebuiltMesh).toBe(false)
  })

  it('mudar estilo/roupa reconstrói a malha', () => {
    const rebuildCaterpillar = vi.fn()
    const context = ctx({ rebuildCaterpillar })
    applyThemeChange(base, { ...base, style: 'neon' }, context)
    expect(rebuildCaterpillar).toHaveBeenCalledTimes(1)
  })

  it('helpers puros', () => {
    expect(outlinePresenceChanged(0, 0.7)).toBe(true)
    expect(outlinePresenceChanged(0.7, 0)).toBe(true)
    expect(outlinePresenceChanged(0.3, 0.9)).toBe(false)
    expect(themeRequiresMeshRebuild(base, { ...base })).toBe(false)
    expect(themeRequiresMeshRebuild(base, { ...base, accessories: ['visor_hud'] })).toBe(true)
  })
})
