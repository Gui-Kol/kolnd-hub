import { describe, expect, it } from 'vitest'
import {
  buildResolutions,
  buildScaleInfo,
  DISPLAY_SCALE_STEPS,
  displayLabel,
  pickRefreshRate,
  refreshLabel,
  resolutionErrorMessage,
  resolutionLabel,
  scaleErrorMessage,
  scaleLabel,
  scaleRelForPercent,
  type DisplayDescriptor,
  type DisplayMode
} from './display'

describe('buildScaleInfo', () => {
  it('mapeia os índices relativos para percentuais ancorados no mínimo', () => {
    expect(buildScaleInfo(0, 0, 3)).toEqual({
      current: 100,
      recommended: 100,
      options: [100, 125, 150, 175]
    })
    expect(buildScaleInfo(0, 2, 3)).toEqual({
      current: 150,
      recommended: 100,
      options: [100, 125, 150, 175]
    })
    expect(buildScaleInfo(-1, 0, 2)).toEqual({
      current: 125,
      recommended: 125,
      options: [100, 125, 150, 175]
    })
  })

  it('prende o atual à faixa suportada em vez de estourar a tabela', () => {
    expect(buildScaleInfo(0, 9, 3)?.current).toBe(175)
    expect(buildScaleInfo(0, -5, 3)?.current).toBe(100)
  })

  it('recusa índices fracionários ou fora da tabela', () => {
    expect(buildScaleInfo(0, 0, 20)).toBeNull()
    expect(buildScaleInfo(0, 0, -1)).toBeNull()
    expect(buildScaleInfo(0.5, 0, 3)).toBeNull()
    expect(buildScaleInfo(Number.NaN, 0, 3)).toBeNull()
    expect(buildScaleInfo(12, 0, 0)).toBeNull()
  })
})

describe('scaleRelForPercent', () => {
  it('converte o percentual no índice relativo ao recomendado', () => {
    expect(scaleRelForPercent(100, 100, 0, 3)).toBe(0)
    expect(scaleRelForPercent(125, 100, 0, 3)).toBe(1)
    expect(scaleRelForPercent(150, 100, 0, 3)).toBe(2)
    expect(scaleRelForPercent(125, 125, -1, 2)).toBe(0)
    expect(scaleRelForPercent(100, 125, -1, 2)).toBe(-1)
  })

  it('recusa percentual fora dos degraus ou da faixa do monitor', () => {
    expect(scaleRelForPercent(110, 100, 0, 3)).toBeNull()
    expect(scaleRelForPercent(500, 100, 0, 3)).toBeNull()
    expect(scaleRelForPercent(125, 100, -2, 0)).toBeNull()
    expect(scaleRelForPercent(125.5, 100, 0, 3)).toBeNull()
  })
})

describe('buildResolutions', () => {
  const modes: DisplayMode[] = [
    { width: 1920, height: 1080, refreshHz: 60 },
    { width: 1920, height: 1080, refreshHz: 165 },
    { width: 1920, height: 1080, refreshHz: 120 },
    { width: 1920, height: 1080, refreshHz: 144 },
    { width: 1280, height: 720, refreshHz: 60 },
    { width: 2560, height: 1440, refreshHz: 60 }
  ]

  it('agrupa por resolução com as taxas em ordem decrescente', () => {
    const resolutions = buildResolutions(modes)
    expect(resolutions.map((r) => `${r.width}x${r.height}`)).toEqual([
      '2560x1440',
      '1920x1080',
      '1280x720'
    ])
    expect(resolutions[1].refreshRates).toEqual([165, 144, 120, 60])
    expect(resolutions[1]).not.toHaveProperty('refreshHz')
    // Sem modo preferido, o primeiro da lista é o recomendado.
    expect(resolutions[0].recommended).toBe(true)
    expect(resolutions.filter((r) => r.recommended)).toHaveLength(1)
  })

  it('marca o modo preferido como recomendado', () => {
    const resolutions = buildResolutions(modes, { width: 1920, height: 1080 })
    const recommended = resolutions.find((r) => r.recommended)
    expect(recommended).toMatchObject({ width: 1920, height: 1080 })
    expect(recommended?.refreshRates[0]).toBe(165)
  })

  it('cai no primeiro da lista quando o preferido não existe', () => {
    const resolutions = buildResolutions(modes, { width: 3840, height: 2160 })
    expect(resolutions[0].recommended).toBe(true)
    expect(resolutions.filter((r) => r.recommended)).toHaveLength(1)
  })

  it('desempata por largura e depois pela maior taxa', () => {
    const tied = buildResolutions([
      { width: 1440, height: 1440, refreshHz: 144 },
      { width: 1920, height: 1080, refreshHz: 60 },
      { width: 1920, height: 1080, refreshHz: 165 }
    ])
    expect(tied.map((r) => r.width)).toEqual([1920, 1440])
    expect(tied[0].refreshRates).toEqual([165, 60])
  })

  it('descarta modos inválidos sem lançar', () => {
    const resolutions = buildResolutions([
      { width: 0, height: 1080, refreshHz: 60 },
      { width: 1920, height: 1080, refreshHz: Number.NaN },
      { width: 800, height: 600, refreshHz: 10 },
      { width: 1024, height: 768, refreshHz: 75 }
    ])
    expect(resolutions).toEqual([
      { width: 1024, height: 768, refreshRates: [75], recommended: true }
    ])
  })

  it('lista vazia devolve lista vazia', () => {
    expect(buildResolutions([])).toEqual([])
  })
})

describe('pickRefreshRate', () => {
  const resolution = {
    width: 1920,
    height: 1080,
    recommended: true,
    refreshRates: [165, 144, 120, 60]
  }

  it('preserva a taxa atual quando a resolução a aceita', () => {
    expect(pickRefreshRate(resolution, 120)).toBe(120)
    expect(pickRefreshRate(resolution, 60)).toBe(60)
  })

  it('cai na maior taxa quando a atual não existe na nova resolução', () => {
    expect(pickRefreshRate(resolution, 75)).toBe(165)
    expect(pickRefreshRate(resolution, 0)).toBe(165)
  })

  it('lista vazia devolve 0 (o Windows escolhe)', () => {
    expect(pickRefreshRate({ ...resolution, refreshRates: [] }, 60)).toBe(0)
  })
})

describe('labels', () => {
  it('rotula resolução com × e (Recomendado)', () => {
    expect(
      resolutionLabel({
        width: 1920,
        height: 1080,
        refreshRates: [165, 60],
        recommended: true
      })
    ).toBe('1920 × 1080 (Recomendado)')
    expect(
      resolutionLabel({ width: 1280, height: 720, refreshRates: [60], recommended: false })
    ).toBe('1280 × 720')
  })

  it('rotula a taxa de atualização com (Recomendado) só na maior', () => {
    expect(refreshLabel(165, 165)).toBe('165 Hz (Recomendado)')
    expect(refreshLabel(60, 165)).toBe('60 Hz')
  })

  it('rotula o monitor com a posição e o nome amigável', () => {
    const display: DisplayDescriptor = {
      id: '\\\\.\\DISPLAY1',
      name: 'DELL U2720Q',
      primary: true,
      width: 1920,
      height: 1080,
      refreshHz: 60,
      resolutions: [],
      scale: null
    }
    expect(displayLabel(display, 0)).toBe('1. DELL U2720Q')
    expect(displayLabel({ ...display, name: 'Monitor 2' }, 1)).toBe('2. Monitor 2')
  })

  it('rotula escala com (Recomendado)', () => {
    expect(scaleLabel(100, 100)).toBe('100% (Recomendado)')
    expect(scaleLabel(125, 100)).toBe('125%')
  })
})

describe('mensagens de erro', () => {
  it('resolução cobre os retornos documentados do Windows', () => {
    expect(resolutionErrorMessage(0)).toContain('alterada')
    expect(resolutionErrorMessage(1)).toContain('reiniciar')
    expect(resolutionErrorMessage(-1)).toContain('não permitiu')
    expect(resolutionErrorMessage(-2)).toContain('não é compatível')
    expect(resolutionErrorMessage(-3)).toContain('salvar')
    expect(resolutionErrorMessage(-5)).toContain('inválida')
    expect(resolutionErrorMessage(-100)).toContain('não está disponível')
    expect(resolutionErrorMessage(-999)).toContain('Não foi possível')
  })

  it('escala cobre sucesso, não suportada, permissão negada e fallback', () => {
    expect(scaleErrorMessage(0)).toContain('alterada')
    expect(scaleErrorMessage(-100)).toContain('não é suportada')
    expect(scaleErrorMessage(5)).toContain('permissão')
    expect(scaleErrorMessage(87)).toContain('não é válida')
    expect(scaleErrorMessage(12345)).toContain('Não foi possível')
  })
})

describe('DISPLAY_SCALE_STEPS', () => {
  it('segue a tabela das Configurações do Windows', () => {
    expect(DISPLAY_SCALE_STEPS).toEqual([
      100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500
    ])
  })
})
