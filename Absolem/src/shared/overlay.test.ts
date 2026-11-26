import { describe, expect, it } from 'vitest'
import {
  normalizeAccelerator,
  normalizeOverlayConfig,
  normalizeOverlayHeight,
  normalizeOverlayWidth,
  OVERLAY_DEFAULT_SHORTCUT
} from './overlay'

describe('normalizadores do overlay', () => {
  it('normaliza posição desconhecida', () => {
    const config = normalizeOverlayConfig({ position: 'middle' })
    expect(config.position).toBe('bottom-left')
  })

  it('largura fora da faixa é corrigida', () => {
    expect(normalizeOverlayWidth(9999)).toBe(480)
    expect(normalizeOverlayWidth(1)).toBe(240)
    expect(normalizeOverlayHeight(9999)).toBe(560)
    expect(normalizeOverlayHeight(1)).toBe(260)
  })

  it('atalho inválido cai no default', () => {
    expect(normalizeOverlayConfig({ shortcut: 'x' }).shortcut).toBe(OVERLAY_DEFAULT_SHORTCUT)
    expect(normalizeAccelerator('ctrl+alt+k')).toBe('Control+Alt+K')
    expect(normalizeAccelerator('tecla-solta')).toBeNull()
  })
})
