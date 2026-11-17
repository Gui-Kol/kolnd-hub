import { describe, expect, it } from 'vitest'
import {
  acceleratorFromKeyEvent,
  fitHudHeight,
  formatAcceleratorLabel,
  HUD_DEFAULT_SHORTCUT,
  isValidAccelerator,
  normalizeAccelerator,
  normalizeHudHeight,
  normalizeHudScale,
  normalizeHudWidth
} from './hud'

// A validação roda no main antes de `globalShortcut.register` e no renderer
// antes de enviar o IPC — os dois lados dependem destas funções puras.
describe('normalizeAccelerator', () => {
  it('normaliza aliases e ordem dos modificadores', () => {
    expect(normalizeAccelerator('alt+ctrl+m')).toBe('Control+Alt+M')
    expect(normalizeAccelerator('  Shift + Ctrl + F12  ')).toBe('Control+Shift+F12')
    expect(normalizeAccelerator('CommandOrControl+Alt+Space')).toBe('Control+Alt+Space')
    expect(normalizeAccelerator('Meta+Shift+Up')).toBe('Shift+Super+Up')
  })

  it('aceita o default e teclas nomeadas conhecidas', () => {
    expect(normalizeAccelerator(HUD_DEFAULT_SHORTCUT)).toBe('Shift+Insert')
    expect(normalizeAccelerator('Ctrl+Alt+PrintScreen')).toBe('Control+Alt+PrintScreen')
    expect(normalizeAccelerator('Ctrl+Alt+PageDown')).toBe('Control+Alt+PageDown')
    expect(normalizeAccelerator('Ctrl+Alt+Esc')).toBe('Control+Alt+Esc')
    expect(normalizeAccelerator('Ctrl+Alt+f24')).toBe('Control+Alt+F24')
  })

  it('rejeita formato inválido, teclas desconhecidas e entradas não-string', () => {
    expect(normalizeAccelerator(null)).toBeNull()
    expect(normalizeAccelerator(123)).toBeNull()
    expect(normalizeAccelerator('')).toBeNull()
    expect(normalizeAccelerator('   ')).toBeNull()
    expect(normalizeAccelerator('M')).toBeNull() // sem modificador
    expect(normalizeAccelerator('Control+')).toBeNull()
    expect(normalizeAccelerator('Control+Alt+')).toBeNull()
    expect(normalizeAccelerator('Control+Alt+Nada')).toBeNull()
    expect(normalizeAccelerator('Control+F25')).toBeNull()
    expect(normalizeAccelerator('Control+Alt+M+N')).toBeNull() // duas teclas
    expect(normalizeAccelerator('Control+Control+M')).toBeNull() // modificador repetido
    expect(normalizeAccelerator(`Control+Alt+${'G'.repeat(80)}`)).toBeNull()
  })

  it('isValidAccelerator espelha a normalização', () => {
    expect(isValidAccelerator('Control+Alt+K')).toBe(true)
    expect(isValidAccelerator('K')).toBe(false)
    expect(isValidAccelerator(undefined)).toBe(false)
  })
})

describe('acceleratorFromKeyEvent', () => {
  const base = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }

  it('converte Ctrl+Alt+M e Ctrl+Shift+F9', () => {
    expect(acceleratorFromKeyEvent({ ...base, key: 'm', ctrlKey: true, altKey: true })).toBe(
      'Control+Alt+M'
    )
    expect(acceleratorFromKeyEvent({ ...base, key: 'F9', ctrlKey: true, shiftKey: true })).toBe(
      'Control+Shift+F9'
    )
  })

  it('ignora teclas modificadoras isoladas e combinações sem modificador', () => {
    expect(acceleratorFromKeyEvent({ ...base, key: 'Control', ctrlKey: true })).toBeNull()
    expect(acceleratorFromKeyEvent({ ...base, key: 'Shift', shiftKey: true })).toBeNull()
    expect(acceleratorFromKeyEvent({ ...base, key: 'm' })).toBeNull()
    expect(acceleratorFromKeyEvent({ ...base, key: 'Dead', ctrlKey: true })).toBeNull()
  })

  it('mapeia espaço e setas para nomes do Electron', () => {
    expect(acceleratorFromKeyEvent({ ...base, key: ' ', ctrlKey: true })).toBe('Control+Space')
    expect(acceleratorFromKeyEvent({ ...base, key: 'ArrowUp', ctrlKey: true })).toBe('Control+Up')
    expect(acceleratorFromKeyEvent({ ...base, key: 'Up', altKey: true })).toBe('Alt+Up')
  })
})

describe('formatAcceleratorLabel', () => {
  it('troca Control por Ctrl e separa com +', () => {
    expect(formatAcceleratorLabel('Control+Alt+M')).toBe('Ctrl + Alt + M')
    expect(formatAcceleratorLabel('Super+Shift+F12')).toBe('Shift + Win + F12')
  })

  it('entrada inválida volta como veio (nunca quebra a UI)', () => {
    expect(formatAcceleratorLabel('qualquer coisa')).toBe('qualquer coisa')
  })
})

describe('tamanho do HUD', () => {
  it('normalizeHudWidth arredonda para o passo de 10 e aplica o clamp 180–560', () => {
    expect(normalizeHudWidth(200)).toBe(200)
    expect(normalizeHudWidth(433)).toBe(430)
    expect(normalizeHudWidth(179)).toBe(180)
    expect(normalizeHudWidth(1)).toBe(180)
    expect(normalizeHudWidth(9999)).toBe(560)
    expect(normalizeHudWidth(-50)).toBe(180)
    expect(normalizeHudWidth(300.4)).toBe(300)
  })

  it('normalizeHudWidth cai no padrão 300 para entradas não numéricas', () => {
    expect(normalizeHudWidth(undefined)).toBe(300)
    expect(normalizeHudWidth(null)).toBe(300)
    expect(normalizeHudWidth('420')).toBe(300)
    expect(normalizeHudWidth(Number.NaN)).toBe(300)
    expect(normalizeHudWidth(Number.POSITIVE_INFINITY)).toBe(300)
  })

  it('normalizeHudScale aceita só a whitelist e cai em normal', () => {
    expect(normalizeHudScale('compacta')).toBe('compacta')
    expect(normalizeHudScale('normal')).toBe('normal')
    expect(normalizeHudScale('grande')).toBe('grande')
    expect(normalizeHudScale('gigante')).toBe('normal')
    expect(normalizeHudScale(null)).toBe('normal')
    expect(normalizeHudScale(42)).toBe('normal')
    expect(normalizeHudScale('COMPACTA')).toBe('normal')
  })

  it('normalizeHudHeight arredonda para cima e mantém 120–1200', () => {
    expect(normalizeHudHeight(300.2)).toBe(301)
    expect(normalizeHudHeight(50)).toBe(120)
    expect(normalizeHudHeight(5000)).toBe(1200)
    expect(normalizeHudHeight(0)).toBe(240)
    expect(normalizeHudHeight(Number.NaN)).toBe(240)
    expect(normalizeHudHeight('300')).toBe(240)
  })

  // A altura medida precisa caber na área de trabalho: sem isso, um conteúdo
  // alto demais (ex.: 300 px/grande com um nome que quebra linha) deixaria o
  // rodapé fora do monitor.
  it('fitHudHeight mantém a altura medida quando cabe na área de trabalho', () => {
    expect(fitHudHeight(888, 1040)).toBe(888)
    expect(fitHudHeight(814, 1040)).toBe(814)
  })

  it('fitHudHeight trunca no espaço disponível (área − 2 × margem)', () => {
    expect(fitHudHeight(1200, 1040)).toBe(1016)
    expect(fitHudHeight(5000, 1040)).toBe(1016)
  })

  it('fitHudHeight ignora área de trabalho inválida e devolve a altura normalizada', () => {
    expect(fitHudHeight(888, Number.NaN)).toBe(888)
    expect(fitHudHeight(888, undefined as unknown as number)).toBe(888)
    expect(fitHudHeight(888, Number.POSITIVE_INFINITY)).toBe(888)
  })

  it('fitHudHeight respeita o piso mínimo mesmo em área de trabalho minúscula', () => {
    expect(fitHudHeight(888, 100)).toBe(120)
    expect(fitHudHeight(888, 0)).toBe(120)
  })

  it('fitHudHeight usa a altura inicial para medição inválida, respeitando o teto', () => {
    expect(fitHudHeight(Number.NaN, 1040)).toBe(240)
    expect(fitHudHeight(undefined, 1040)).toBe(240)
    expect(fitHudHeight('300', 200)).toBe(176)
  })
})
