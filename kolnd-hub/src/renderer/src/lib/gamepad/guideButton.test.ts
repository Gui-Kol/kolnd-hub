import { describe, expect, it } from 'vitest'
import { createGuideButtonDetector, GUIDE_PRESS_THRESHOLD, isGuideButtonDown } from './guideButton'

interface FakeButton {
  pressed: boolean
  value: number
}

function pad(id = 'pad-1', buttonCount = 17): Gamepad {
  return {
    id,
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: buttonCount }, () => ({ pressed: false, value: 0 }))
  } as unknown as Gamepad
}

function setButton(
  current: Gamepad,
  index: number,
  pressed: boolean,
  value = pressed ? 1 : 0
): void {
  ;(current.buttons[index] as FakeButton) = { pressed, value }
}

describe('isGuideButtonDown', () => {
  it('lê o índice 16 por pressed ou por value acima do limiar', () => {
    const current = pad()
    expect(isGuideButtonDown(current)).toBe(false)

    setButton(current, 16, false, GUIDE_PRESS_THRESHOLD + 0.1)
    expect(isGuideButtonDown(current)).toBe(true)

    setButton(current, 16, false, GUIDE_PRESS_THRESHOLD)
    expect(isGuideButtonDown(current)).toBe(false)

    setButton(current, 16, true, 0)
    expect(isGuideButtonDown(current)).toBe(true)
  })

  it('pad nulo ou sem índice 16 não está pressionado', () => {
    expect(isGuideButtonDown(null)).toBe(false)
    expect(isGuideButtonDown(pad('curto', 16))).toBe(false)
  })
})

describe('createGuideButtonDetector', () => {
  it('dispara uma única vez na borda e não repete enquanto segura', () => {
    const detector = createGuideButtonDetector()
    const current = pad()

    expect(detector.update([current])).toBe(false) // prime silencioso
    setButton(current, 16, true)
    expect(detector.update([current])).toBe(true)
    expect(detector.update([current])).toBe(false)
    expect(detector.update([current])).toBe(false)
  })

  it('soltar e apertar de novo dispara outra vez', () => {
    const detector = createGuideButtonDetector()
    const current = pad()
    detector.update([current])

    setButton(current, 16, true)
    expect(detector.update([current])).toBe(true)
    setButton(current, 16, false)
    expect(detector.update([current])).toBe(false)
    setButton(current, 16, true)
    expect(detector.update([current])).toBe(true)
  })

  it('prime silencioso: botão já pressionado ao armar não dispara', () => {
    const detector = createGuideButtonDetector()
    const current = pad()
    setButton(current, 16, true)

    expect(detector.update([current])).toBe(false)
    expect(detector.update([current])).toBe(false)

    setButton(current, 16, false)
    detector.update([current])
    setButton(current, 16, true)
    expect(detector.update([current])).toBe(true)
  })

  it('pad sem o índice 16 é ignorado (usa o primeiro que exponha)', () => {
    const detector = createGuideButtonDetector()
    const semGuide = pad('sem-guide', 16)
    const comGuide = pad('com-guide')

    expect(detector.update([semGuide])).toBe(false)
    setButton(comGuide, 16, true)
    // Prime do pad novo (o sem-guide nem armou estado).
    expect(detector.update([semGuide, comGuide])).toBe(false)
    setButton(comGuide, 16, false)
    detector.update([semGuide, comGuide])
    setButton(comGuide, 16, true)
    expect(detector.update([semGuide, comGuide])).toBe(true)
  })

  it('trocar de pad reseta (prime silencioso no pad novo)', () => {
    const detector = createGuideButtonDetector()
    const first = pad('pad-1')
    detector.update([first])
    setButton(first, 16, true)
    expect(detector.update([first])).toBe(true)

    // O segundo pad chega já pressionado: não pode herdar a borda do primeiro.
    const second = pad('pad-2')
    setButton(second, 16, true)
    expect(detector.update([second])).toBe(false)
    expect(detector.update([second])).toBe(false)
  })

  it('sem pad reseta', () => {
    const detector = createGuideButtonDetector()
    const current = pad()
    detector.update([current])
    setButton(current, 16, true)
    expect(detector.update([current])).toBe(true)

    expect(detector.update([null])).toBe(false)
    // Ao voltar, o botão ainda pressionado é o novo prime — não dispara.
    expect(detector.update([current])).toBe(false)
    setButton(current, 16, false)
    detector.update([current])
    setButton(current, 16, true)
    expect(detector.update([current])).toBe(true)
  })

  it('reset explícito rearma em silêncio', () => {
    const detector = createGuideButtonDetector()
    const current = pad()
    detector.update([current])
    setButton(current, 16, true)
    expect(detector.update([current])).toBe(true)

    detector.reset()
    expect(detector.update([current])).toBe(false)
    expect(detector.update([current])).toBe(false)
  })

  it('value acima do limiar conta como pressionado', () => {
    const detector = createGuideButtonDetector()
    const current = pad()
    detector.update([current])

    setButton(current, 16, false, 0.7)
    expect(detector.update([current])).toBe(true)
  })
})
