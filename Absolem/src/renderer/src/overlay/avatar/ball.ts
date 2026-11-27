import type { AvatarState, AvatarTheme } from '../../../../shared/avatar'
import { clampAvatarLevel, normalizeAvatarState } from '../../../../shared/avatar'
import type { ThemeConfig } from '../../../../shared/theme'
import type { AvatarLook } from './looks'
import { clampBallScale, toBallTheme } from './themeAdapter'

/**
 * Avatar 2D em Canvas2D (task 27).
 *
 * A lagarta e a cena WebGL foram aposentadas: o personagem é uma bola
 * procedural, sem `three`, sem WebGL, sem asset externo e sem dependência nova.
 * O contrato de `mountAvatar`/`AvatarHandle` continua o mesmo para o overlay e
 * para o preview da aba Aparência.
 *
 * O tema entra apenas por escala e movimento reduzido (`themeAdapter.ts`); as
 * cores do corpo são fixas por estado, por decisão de produto. O estado muda a
 * cor; a escala do tema muda o diâmetro; `reducedMotion` congela a animação sem
 * impedir a troca de cor.
 */

export interface AvatarMetrics {
  fps: number
  frameMs: number
  drawCalls: number
  triangles: number
  /** Nível de degradação vigente (sempre 0 na bola; mantido por contrato). */
  degradation: number
}

export interface AvatarSceneOptions {
  state?: AvatarState
  level?: number
  /** Compatibilidade da task 03: accent nunca muda a cor da bola. */
  theme?: AvatarTheme
  /** Tema completo; só `scale` e `reducedMotion` têm efeito. */
  themeConfig?: ThemeConfig
  /** Compatibilidade: estilo/roupa/acessórios não têm efeito visual. */
  style?: string
  outfit?: string
  seed?: number
  /** Compatibilidade: `holo`/`storybook` viram só dados; sem efeito visual. */
  look?: AvatarLook | string
  /** Visibilidade do overlay (push `overlay:status-changed`). */
  visible?: boolean
  reducedMotion?: boolean
  /** Compatibilidade: partículas não existem mais. */
  particleScale?: number
  /** Limite de DPR; o teto do produto continua sendo 2. */
  pixelRatioCap?: number
  /** Compatibilidade: contorno não existe mais. */
  outlineStrength?: number
  /** Compatibilidade: degradação automática não existe mais. */
  slow?: boolean
  debug?: boolean
  onFallback?: (reason: string) => void
  onDegrade?: (level: number) => void
}

export interface AvatarHandle {
  readonly canvas: HTMLCanvasElement
  setState: (state: AvatarState) => void
  setLevel: (level: number) => void
  /** Compatibilidade da task 03: troca só a cor principal; sem efeito na bola. */
  setTheme: (theme: AvatarTheme) => void
  /** Task 04: aplica o tema completo sem reiniciar canvas/loop. */
  applyTheme: (theme: ThemeConfig) => void
  /** Task 19: ajuste de contorno; no-op seguro na bola. */
  setOutlineStrength: (strength: number) => void
  /** Task 19: troca de acabamento; no-op seguro na bola. */
  setLook: (look: AvatarLook | string) => void
  setVisible: (visible: boolean) => void
  setReducedMotion: (reduced: boolean) => void
  resize: () => void
  dispose: () => void
  getMetrics: () => AvatarMetrics
  getState: () => AvatarState
  isRunning: () => boolean
}

/** Cores fixas por estado; independentes do tema. */
export const BALL_COLORS: Record<AvatarState, string> = {
  idle: '#3b82f6',
  listening: '#22c55e',
  speaking: '#eab308',
  thinking: '#f59e0b',
  error: '#ef4444'
}

/** Diâmetro em repouso como fração do menor lado do canvas. */
export const BALL_DIAMETER_RATIO = 0.46

const TAU = Math.PI * 2
const METRIC_WINDOW = 90

const ZERO_METRICS: AvatarMetrics = {
  fps: 0,
  frameMs: 0,
  drawCalls: 0,
  triangles: 0,
  degradation: 0
}

export function ballColorForState(state: AvatarState): string {
  return BALL_COLORS[state] ?? BALL_COLORS.idle
}

/** Diâmetro da bola para o menor lado do canvas, com a escala do tema. */
export function ballDiameter(minSide: number, scale = 1): number {
  const side = Number.isFinite(minSide) ? Math.max(1, minSide) : 1
  return side * BALL_DIAMETER_RATIO * clampBallScale(scale)
}

export interface BallVisualFrame {
  /** Fase do pulso normalizada em 0..1; 0 quando não há animação. */
  pulse: number
  /** Multiplicador do diâmetro base; 1 no repouso estático. */
  diameterScale: number
  /** Intensidade do halo em 0..1. */
  glow: number
}

export interface BallMotion {
  timeSeconds: number
  level: number
  reducedMotion: boolean
}

/**
 * Pulso por estado, em função pura do tempo (segundos), do nível 0..1 e do
 * movimento reduzido. Amplitudes: idle ±2,5%; listening ±6%; speaking ±14%;
 * thinking ±8%; error parado.
 */
export function ballVisualFrame(state: AvatarState, motion: BallMotion): BallVisualFrame {
  const level = clampAvatarLevel(motion.level)
  if (motion.reducedMotion) {
    return { pulse: 0, diameterScale: 1, glow: stateGlow(state, level) }
  }

  const time = Number.isFinite(motion.timeSeconds) ? Math.max(0, motion.timeSeconds) : 0
  switch (state) {
    case 'listening': {
      const wave = Math.sin((TAU * time) / 1.6)
      return makeFrame(wave, 0.06 * (0.35 + 0.65 * level), stateGlow(state, level))
    }
    case 'speaking': {
      const carrier = Math.sin((TAU * time) / 0.9)
      const envelope = 0.55 + 0.45 * Math.sin((TAU * time) / 2.3)
      return makeFrame(carrier * envelope, 0.14 * (0.3 + 0.7 * level), stateGlow(state, level))
    }
    case 'thinking': {
      const wave = Math.sin((TAU * time) / 1.4)
      return makeFrame(wave, 0.08, stateGlow(state, level))
    }
    case 'error':
      return { pulse: 0, diameterScale: 1, glow: stateGlow(state, level) }
    default: {
      const wave = Math.sin((TAU * time) / 3.2)
      return makeFrame(wave, 0.025, stateGlow(state, level))
    }
  }
}

function stateGlow(state: AvatarState, level: number): number {
  switch (state) {
    case 'listening':
      return 0.35 + 0.35 * level
    case 'speaking':
      return 0.4 + 0.45 * level
    case 'thinking':
      return 0.55
    case 'error':
      return 0.4
    default:
      return 0.3
  }
}

function makeFrame(wave: number, amplitude: number, glow: number): BallVisualFrame {
  const clamped = Math.max(-1, Math.min(1, wave))
  return {
    pulse: (clamped + 1) / 2,
    diameterScale: 1 + clamped * amplitude,
    glow: Math.min(1, Math.max(0, glow))
  }
}

interface Rgb {
  r: number
  g: number
  b: number
}

function parseHex(hex: string): Rgb {
  const body = hex.replace('#', '')
  return {
    r: Number.parseInt(body.slice(0, 2), 16),
    g: Number.parseInt(body.slice(2, 4), 16),
    b: Number.parseInt(body.slice(4, 6), 16)
  }
}

/** `amount` positivo clareia na direção do branco; negativo escurece. */
function shade(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex)
  const target = amount >= 0 ? 255 : 0
  const mix = Math.min(1, Math.abs(amount))
  const channel = (value: number): number => Math.round(value + (target - value) * mix)
  return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`
}

/** Como `shade`, mas devolvendo `rgba()` com alfa; entrada sempre em hex. */
function shadeRgba(hex: string, amount: number, alpha: number): string {
  const { r, g, b } = parseHex(hex)
  const target = amount >= 0 ? 255 : 0
  const mix = Math.min(1, Math.abs(amount))
  const channel = (value: number): number => Math.round(value + (target - value) * mix)
  return `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${Math.min(1, Math.max(0, alpha))})`
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

type RafSchedule = (callback: FrameRequestCallback) => number
type RafCancel = (handle: number) => void

function resolveRaf(): { raf: RafSchedule; cancel: RafCancel } {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return {
      raf: (callback) => window.requestAnimationFrame(callback),
      cancel: (handle) => window.cancelAnimationFrame(handle)
    }
  }
  const globalScope = globalThis as {
    requestAnimationFrame?: RafSchedule
    cancelAnimationFrame?: RafCancel
  }
  if (typeof globalScope.requestAnimationFrame === 'function') {
    return {
      raf: globalScope.requestAnimationFrame,
      cancel: (handle) => globalScope.cancelAnimationFrame?.(handle)
    }
  }
  return {
    raf: (callback) => setTimeout(() => callback(now()), 16) as unknown as number,
    cancel: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
  }
}

function inertHandle(
  canvas: HTMLCanvasElement,
  reason: string,
  onFallback: ((reason: string) => void) | undefined
): AvatarHandle {
  console.warn('avatar: fallback', reason)
  onFallback?.(reason)
  return {
    canvas,
    setState: () => undefined,
    setLevel: () => undefined,
    setTheme: () => undefined,
    applyTheme: () => undefined,
    setOutlineStrength: () => undefined,
    setLook: () => undefined,
    setVisible: () => undefined,
    setReducedMotion: () => undefined,
    resize: () => undefined,
    dispose: () => undefined,
    getMetrics: () => ({ ...ZERO_METRICS }),
    getState: () => 'idle',
    isRunning: () => false
  }
}

/** Cria o avatar bola no canvas. Sem Canvas2D, devolve o handle inerte. */
export function createAvatarBall(
  canvas: HTMLCanvasElement,
  options: AvatarSceneOptions = {}
): AvatarHandle {
  let context: CanvasRenderingContext2D | null
  try {
    context = canvas.getContext('2d') as CanvasRenderingContext2D | null
  } catch {
    context = null
  }
  if (!context) return inertHandle(canvas, 'canvas2d-indisponivel', options.onFallback)

  const ctx = context
  const scheduler = resolveRaf()
  const requestedPixelRatio =
    typeof options.pixelRatioCap === 'number' &&
    Number.isFinite(options.pixelRatioCap) &&
    options.pixelRatioCap > 0
      ? options.pixelRatioCap
      : null

  let state: AvatarState = normalizeAvatarState(options.state)
  let level = clampAvatarLevel(options.level)
  let themeScale = 1
  let reducedMotion = options.reducedMotion === true
  if (options.themeConfig) {
    const adapted = toBallTheme(options.themeConfig)
    themeScale = adapted.scale
    reducedMotion = reducedMotion || adapted.reducedMotion
  }

  let cssWidth = 1
  let cssHeight = 1
  let pixelRatio = 1
  let overlayVisible = options.visible ?? true
  let pageVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden'
  let disposed = false
  let rafId: number | null = null
  let lastTimestamp: number | null = null
  let elapsedSeconds = 0
  let drawCalls = 0
  const frameTimes: number[] = []

  function resetMetrics(): void {
    frameTimes.length = 0
    drawCalls = 0
  }

  function computePixelRatio(): number {
    const device =
      typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
        ? window.devicePixelRatio
        : 1
    const requested = requestedPixelRatio ?? device
    return Math.min(2, Math.max(0.5, requested))
  }

  function paint(seconds: number): void {
    if (disposed) return
    const width = cssWidth
    const height = cssHeight
    if (width < 1 || height < 1) return

    ctx.clearRect(0, 0, width, height)

    const frame = ballVisualFrame(state, {
      timeSeconds: reducedMotion ? 0 : seconds,
      level,
      reducedMotion
    })
    const color = ballColorForState(state)
    const baseRadius = ballDiameter(Math.min(width, height), themeScale) / 2
    const radius = Math.max(1, baseRadius * frame.diameterScale)
    const centerX = width / 2
    const centerY = height / 2

    // Halo externo: cor do estado, mais forte conforme o pulso/estado.
    const glowRadius = radius * (1.7 + frame.glow * 0.6)
    const glow = ctx.createRadialGradient(
      centerX,
      centerY,
      radius * 0.55,
      centerX,
      centerY,
      glowRadius
    )
    glow.addColorStop(0, rgba(color, 0.2 + frame.glow * 0.3))
    glow.addColorStop(0.55, rgba(color, 0.08 + frame.glow * 0.06))
    glow.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(centerX, centerY, glowRadius, 0, TAU)
    ctx.fill()

    // Esfera: brilho deslocado para cima/esquerda, núcleo na cor do estado e
    // borda escurecida. Nenhum asset; tudo gradiente radial do Canvas2D.
    const sphere = ctx.createRadialGradient(
      centerX - radius * 0.36,
      centerY - radius * 0.42,
      Math.max(1, radius * 0.08),
      centerX,
      centerY,
      radius
    )
    sphere.addColorStop(0, shade(color, 0.38))
    sphere.addColorStop(0.42, color)
    sphere.addColorStop(0.84, shade(color, -0.16))
    sphere.addColorStop(1, shade(color, -0.26))
    ctx.fillStyle = sphere
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, 0, TAU)
    ctx.fill()

    // Brilho especular suave, no mesmo canto da luz.
    const highlight = ctx.createRadialGradient(
      centerX - radius * 0.32,
      centerY - radius * 0.38,
      0,
      centerX - radius * 0.32,
      centerY - radius * 0.38,
      radius * 0.44
    )
    highlight.addColorStop(0, 'rgba(255, 255, 255, 0.5)')
    highlight.addColorStop(0.45, 'rgba(255, 255, 255, 0.12)')
    highlight.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = highlight
    ctx.beginPath()
    ctx.arc(centerX - radius * 0.32, centerY - radius * 0.38, radius * 0.44, 0, TAU)
    ctx.fill()

    // Anel de borda quase imperceptível, só para separar do fundo claro.
    const rimWidth = Math.max(1, radius * 0.02)
    ctx.strokeStyle = shadeRgba(color, 0.4, 0.4)
    ctx.lineWidth = rimWidth
    ctx.beginPath()
    ctx.arc(centerX, centerY, Math.max(0, radius - rimWidth / 2), 0, TAU)
    ctx.stroke()

    drawCalls = 1
  }

  function resize(): void {
    if (disposed) return
    const fallbackWidth = pixelRatio > 0 ? canvas.width / pixelRatio : canvas.width
    const fallbackHeight = pixelRatio > 0 ? canvas.height / pixelRatio : canvas.height
    cssWidth = Math.max(1, Math.round(canvas.clientWidth || fallbackWidth || 1))
    cssHeight = Math.max(1, Math.round(canvas.clientHeight || fallbackHeight || 1))
    pixelRatio = computePixelRatio()
    canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio))
    canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio))
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    paint(elapsedSeconds)
  }

  function shouldRun(): boolean {
    return !disposed && overlayVisible && pageVisible
  }

  function stopLoop(): void {
    if (rafId !== null) scheduler.cancel(rafId)
    rafId = null
    lastTimestamp = null
    resetMetrics()
  }

  function tick(timestamp: number): void {
    if (!shouldRun()) {
      stopLoop()
      return
    }
    const deltaMs = lastTimestamp === null ? 0 : Math.max(0, timestamp - lastTimestamp)
    lastTimestamp = timestamp
    if (deltaMs > 0) {
      elapsedSeconds += deltaMs / 1000
      frameTimes.push(deltaMs)
      if (frameTimes.length > METRIC_WINDOW) frameTimes.shift()
    }
    paint(elapsedSeconds)
    rafId = scheduler.raf(tick)
  }

  function startLoop(): void {
    if (rafId !== null || !shouldRun()) return
    lastTimestamp = null
    rafId = scheduler.raf(tick)
  }

  function syncRunning(): void {
    if (shouldRun()) startLoop()
    else stopLoop()
  }

  const onVisibilityChange = (): void => {
    pageVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden'
    syncRunning()
  }
  const onWindowResize = (): void => resize()

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onWindowResize)
  }

  resize()
  syncRunning()

  return {
    canvas,
    setState(next: AvatarState): void {
      state = normalizeAvatarState(next)
    },
    setLevel(next: number): void {
      level = clampAvatarLevel(next)
    },
    setTheme(_theme: AvatarTheme): void {
      // Compatibilidade: a bola não usa o accent do store.
    },
    applyTheme(theme: ThemeConfig): void {
      const next = toBallTheme(theme)
      themeScale = next.scale
      reducedMotion = next.reducedMotion
      resize()
    },
    setOutlineStrength(_strength: number): void {
      // Compatibilidade: sem contorno na bola.
    },
    setLook(_look: AvatarLook | string): void {
      // Compatibilidade: holo/storybook não têm efeito visual na bola.
    },
    setVisible(visible: boolean): void {
      overlayVisible = visible
      syncRunning()
    },
    setReducedMotion(reduced: boolean): void {
      reducedMotion = reduced
    },
    resize,
    dispose(): void {
      if (disposed) return
      disposed = true
      stopLoop()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', onWindowResize)
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    },
    getMetrics(): AvatarMetrics {
      if (rafId === null || frameTimes.length === 0) return { ...ZERO_METRICS }
      const total = frameTimes.reduce((sum, value) => sum + value, 0)
      const frameMs = total / frameTimes.length
      return {
        fps: frameMs > 0 ? Math.round((1000 / frameMs) * 10) / 10 : 0,
        frameMs: Math.round(frameMs * 10) / 10,
        drawCalls,
        triangles: 0,
        degradation: 0
      }
    },
    getState(): AvatarState {
      return state
    },
    isRunning(): boolean {
      return rafId !== null
    }
  }
}
