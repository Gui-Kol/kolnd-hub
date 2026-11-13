import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isSfxEnabled, playSfx, setSfxEnabled } from './sfx'

type MockAudioContext = {
  state: string
  currentTime: number
  sampleRate: number
  resume: ReturnType<typeof vi.fn>
  createGain: ReturnType<typeof vi.fn>
  createOscillator: ReturnType<typeof vi.fn>
  createBuffer: ReturnType<typeof vi.fn>
  createBufferSource: ReturnType<typeof vi.fn>
  destination: unknown
}

const originalWindow = globalThis.window

function installWindow(win: unknown): void {
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true
  })
}

function restoreWindow(): void {
  Object.defineProperty(globalThis, 'window', {
    value: originalWindow,
    configurable: true
  })
}

type MockCtx = MockAudioContext & {
  gain: {
    connect: ReturnType<typeof vi.fn>
    gain: {
      setValueAtTime: ReturnType<typeof vi.fn>
      exponentialRampToValueAtTime: ReturnType<typeof vi.fn>
    }
  }
  osc: {
    connect: ReturnType<typeof vi.fn>
    frequency: { setValueAtTime: ReturnType<typeof vi.fn> }
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    type: string
  }
}

const createdContexts: MockCtx[] = []

function mockContext(): MockCtx {
  const gain = {
    connect: vi.fn(),
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn()
    }
  }
  const osc = {
    connect: vi.fn(),
    frequency: { setValueAtTime: vi.fn() },
    start: vi.fn(),
    stop: vi.fn(),
    type: ''
  }
  const ctx: MockAudioContext & { gain: typeof gain; osc: typeof osc } = {
    state: 'suspended',
    currentTime: 100,
    sampleRate: 44100,
    resume: vi.fn().mockResolvedValue(undefined),
    createGain: vi.fn(() => gain),
    createOscillator: vi.fn(() => osc),
    createBuffer: vi.fn(() => ({ getChannelData: () => new Float32Array(0) })),
    createBufferSource: vi.fn(() => ({
      buffer: null,
      start: vi.fn(),
      stop: vi.fn(),
      connect: vi.fn()
    })),
    destination: {},
    gain,
    osc
  }
  createdContexts.push(ctx)
  return ctx
}

beforeEach(() => {
  setSfxEnabled(true)
  restoreWindow()
})

afterEach(() => {
  restoreWindow()
  vi.restoreAllMocks()
})

describe('setSfxEnabled / isSfxEnabled', () => {
  it('liga e desliga os efeitos sonoros', () => {
    expect(isSfxEnabled()).toBe(true)
    setSfxEnabled(false)
    expect(isSfxEnabled()).toBe(false)
    setSfxEnabled(true)
    expect(isSfxEnabled()).toBe(true)
  })

  it('aceita qualquer valor e normaliza para booleano', () => {
    setSfxEnabled(1 as unknown as boolean)
    expect(isSfxEnabled()).toBe(true)
    setSfxEnabled(0 as unknown as boolean)
    expect(isSfxEnabled()).toBe(false)
    setSfxEnabled(null as unknown as boolean)
    expect(isSfxEnabled()).toBe(false)
  })
})

describe('playSfx — desligado / sem áudio disponível (nunca lança)', () => {
  it('com SFX desligado não toca nada e não lança, mesmo sem window', () => {
    setSfxEnabled(false)
    restoreWindow() // window indefinido em node
    expect(() => playSfx('move')).not.toThrow()
    expect(() => playSfx('launch')).not.toThrow()
  })

  it('com SFX ligado mas sem AudioContext disponível não lança', () => {
    setSfxEnabled(true)
    installWindow({}) // sem AudioContext
    expect(() => playSfx('confirm')).not.toThrow()
    expect(() => playSfx('impact')).not.toThrow()
  })
})

describe('playSfx — com Web Audio API disponível', () => {
  const AudioContextMock = vi.fn(() => mockContext())

  beforeEach(() => {
    installWindow({ AudioContext: AudioContextMock })
  })

  // O audioContext é cacheado em nível de módulo pelo sfx.ts. O teste de erro
  // roda primeiro (cache ainda nulo) e não cria contexto; o teste de sons roda
  // em seguida, cria o contexto único e nele verificamos move + impacto.
  it('erros de áudio não quebram a navegação (construtor que lança)', () => {
    setSfxEnabled(true)
    installWindow({
      AudioContext: vi.fn(() => {
        throw new Error('áudio indisponível')
      })
    })
    expect(() => playSfx('open')).not.toThrow()
  })

  it('toca sons (move e impacto) sem lançar, usando o contexto de áudio', () => {
    setSfxEnabled(true)

    playSfx('move')
    const ctx = createdContexts[0]!
    expect(ctx.resume).toHaveBeenCalled()
    expect(ctx.createOscillator).toHaveBeenCalled()
    expect(ctx.osc.type).toBe('square')
    expect(ctx.osc.start).toHaveBeenCalled()
    expect(ctx.osc.stop).toHaveBeenCalled()
    expect(ctx.gain.connect).toHaveBeenCalledWith(ctx.destination)

    playSfx('impact')
    expect(ctx.createBuffer).toHaveBeenCalled()

    expect(() => playSfx('zap')).not.toThrow()
    expect(() => playSfx('wave')).not.toThrow()
  })
})
