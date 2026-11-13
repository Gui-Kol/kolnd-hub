// Transição cinematográfica de entrada no Big Picture (T7).
//
// Um único <canvas> + um único rAF desenham raio, choque elétrico e onda de
// energia por cima do shell. A revelação do fundo do Big Picture é feita por
// uma máscara radial (`mask-image`) na camada de fundo — animada pela mesma
// curva/timestamp da frente de onda, sem re-render de layout (a variável do
// mask é escrita direto no estilo do nó, nunca via setState por frame).
//
// Fases (timestamps relativos à montagem, `performance.now()`):
//   Fase 1 — Escurecimento  0–400 ms   overlay preto 0 → 0.85 (CSS transition)
//   Fase 2 — Raio           400–1000   raio do topo ao centro (flicker por frame)
//   Fase 3 — Impacto        1000–1350  flash + 3 anéis de choque + faíscas + arcos
//   Fase 4 — Onda radial    1100–1900  frente circular expansiva (sobreposta à 3)
//   Fase 5 — Revelação      1000–2000  máscara radial do fundo (em paralelo à 4)
//   Fase 6 — Decaimento     1900–2600  efeitos esmaecem; overlay 0.85 → 0.15
//   Fase 7 — Pronto         2600–2900  canvas desmonta; home faz fade/slide-in
//
// SKIP (documentado por contrato): qualquer botão de gamepad, clique, Esc ou
// Enter encerra a animação imediatamente — máscara removida, overlay zerado e
// a home pronta. Animação nunca bloqueia a entrada do usuário.
//
// `prefers-reduced-motion: reduce` vira um simples fade de 250 ms.
// Falha ao criar o contexto 2D do canvas → fallback silencioso para o mesmo
// fade. Em ambos os casos a entrada no Big Picture nunca é impedida.
// A saída do Big Picture NÃO usa esta animação (fade curto no shell).

import { useCallback, useEffect, useRef } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { playSfx } from '../lib/sfx'

export interface BigPictureTransitionProps {
  /** Camada de fundo do Big Picture — recebe a máscara radial animada (fase 5). */
  backgroundRef: RefObject<HTMLDivElement | null>
  /** Fase 7: a home (rail + conteúdo) pode iniciar o fade/slide-in. */
  onHomeReveal: () => void
  /** Fim (natural ou pulado) — desmonta o overlay e libera o Big Picture. */
  onComplete: () => void
}

// ── Linha do tempo (ms) ─────────────────────────────────────────────
const BOLT_START = 400
const BOLT_END = 1000
const IMPACT_AT = 1000
const IMPACT_END = 1350
const WAVE_START = 1100
const WAVE_END = 1900
const REVEAL_START = 1000
const REVEAL_END = 2000
const DECAY_START = 1900
const DECAY_END = 2600
const HOME_REVEAL_AT = 2600
const FADE_END = 2900
// Raio inicial da máscara de revelação (≈"ponto de impacto" antes da onda).
export const REVEAL_FROM = 120

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)
const easeOutCubic = (p: number): number => 1 - Math.pow(1 - clamp01(p), 3)
const easeInOutSine = (p: number): number => -(Math.cos(Math.PI * clamp01(p)) - 1) / 2

/** Máscara radial correspondente a um raio `r` (px); `null` remove a máscara. */
export function revealMaskStyle(radiusPx: number | null): CSSProperties {
  if (radiusPx === null) {
    return { maskImage: 'none', WebkitMaskImage: 'none' }
  }
  const image = `radial-gradient(circle at 50% 50%, black ${radiusPx}px, transparent ${radiusPx}px)`
  return { maskImage: image, WebkitMaskImage: image }
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  born: number
  life: number
  size: number
  gravity: number
  cyan: boolean
}

interface ShockRing {
  delay: number
  maxR: number
  lineWidth: number
  color: string
  glow: string
}

interface SideArc {
  angle: number
  length: number
  born: number
  /** Deslocamentos perpendiculares pré-sorteados (jitter do arco). */
  offsets: number[]
}

export function BigPictureTransition({
  backgroundRef,
  onHomeReveal,
  onComplete
}: BigPictureTransitionProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const darkRef = useRef<HTMLDivElement>(null)

  // Callbacks sempre frescos (o rAF nunca enxerga versão obsoleta).
  const callbacksRef = useRef({ onHomeReveal, onComplete })
  useEffect(() => {
    callbacksRef.current = { onHomeReveal, onComplete }
  })

  const doneRef = useRef(false)
  const rafRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const t0Ref = useRef(0)
  const lastRef = useRef(0)
  const sizeRef = useRef({ w: 0, h: 0, maxR: 0 })
  const flagsRef = useRef({
    zap: false,
    impact: false,
    wave: false,
    home: false,
    maskCleared: false
  })
  const sparksRef = useRef<Spark[]>([])
  const ringsRef = useRef<ShockRing[]>([])
  const arcsRef = useRef<SideArc[]>([])
  // Estado da borda de botão (skip): primeira amostra só memoriza, sem pular.
  const gamepadBaselineRef = useRef<boolean | null>(null)

  /** Encerra a transição (natural ou pulada): zera máscara/overlay e libera a home. */
  const finish = useCallback((): void => {
    if (doneRef.current) return
    doneRef.current = true
    cancelAnimationFrame(rafRef.current)

    const bg = backgroundRef.current
    if (bg) {
      bg.style.maskImage = 'none'
      bg.style.setProperty('-webkit-mask-image', 'none')
    }
    // Limpa o canvas para não congelar um frame residual nos ~190 ms restantes.
    const canvas = canvasRef.current
    if (canvas) {
      try {
        const ctx = canvas.getContext('2d')
        ctx?.clearRect(0, 0, window.innerWidth, window.innerHeight)
      } catch {
        // ignore — o canvas desmonta em seguida
      }
    }
    const dark = darkRef.current
    if (dark) {
      dark.style.transition = 'opacity 180ms ease-out'
      dark.style.opacity = '0'
    }
    if (!flagsRef.current.home) {
      flagsRef.current.home = true
      playSfx('open')
      callbacksRef.current.onHomeReveal()
    }
    // Pequena espera para o overlay terminar de desaparecer antes de desmontar.
    timerRef.current = window.setTimeout(() => callbacksRef.current.onComplete(), 190)
  }, [backgroundRef])

  const skip = useCallback((): void => finish(), [finish])

  useEffect(() => {
    t0Ref.current = performance.now()
    lastRef.current = t0Ref.current
    const dark = darkRef.current
    const bg = backgroundRef.current
    if (bg) {
      // Estado inicial da fase 5: só um pequeno círculo visível no impacto.
      const image = `radial-gradient(circle at 50% 50%, black ${REVEAL_FROM}px, transparent ${REVEAL_FROM}px)`
      bg.style.maskImage = image
      bg.style.setProperty('-webkit-mask-image', image)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      // SKIP: Esc/Enter pulam direto para o fim (documentado no cabeçalho).
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault()
        skip()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    const clearTimers = (): void => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // ── Caminho reduzido/fallback: fade simples, sem raio nem onda ──
    const startFadeFallback = (fadeMs: number): (() => void) => {
      if (bg) {
        bg.style.maskImage = 'none'
        bg.style.setProperty('-webkit-mask-image', 'none')
      }
      if (dark) {
        dark.style.transition = 'none'
        dark.style.opacity = '0.85'
        void dark.offsetWidth // força reflow para a transição pegar
        dark.style.transition = `opacity ${fadeMs}ms ease-out`
        dark.style.opacity = '0'
      }
      const revealTimer = window.setTimeout(
        () => {
          if (!flagsRef.current.home) {
            flagsRef.current.home = true
            playSfx('open')
            callbacksRef.current.onHomeReveal()
          }
        },
        Math.round(fadeMs * 0.4)
      )
      const doneTimer = window.setTimeout(() => finish(), fadeMs + 40)
      return (): void => {
        window.clearTimeout(revealTimer)
        window.clearTimeout(doneTimer)
      }
    }

    if (prefersReduced) {
      const cleanup = startFadeFallback(250)
      return (): void => {
        window.removeEventListener('keydown', onKeyDown)
        clearTimers()
        cleanup()
      }
    }

    // ── Canvas 2D (falha → fade silencioso, entrada nunca bloqueada) ──
    const canvas = canvasRef.current
    let ctx: CanvasRenderingContext2D | null = null
    try {
      ctx = canvas ? canvas.getContext('2d') : null
    } catch {
      ctx = null
    }
    if (!canvas || !ctx) {
      const cleanup = startFadeFallback(400)
      return (): void => {
        window.removeEventListener('keydown', onKeyDown)
        clearTimers()
        cleanup()
      }
    }

    // Fase 1: escurecimento via CSS transition (0 → 0.85 em 400 ms).
    if (dark) {
      dark.style.transition = 'opacity 400ms ease-out'
      // Duplo rAF garante que o valor inicial (0) já foi pintado.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          dark.style.opacity = '0.85'
        })
      })
    }

    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = window.innerWidth
      const h = window.innerHeight
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      sizeRef.current = { w, h, maxR: Math.hypot(w, h) / 2 + 100 }
    }
    resize()
    window.addEventListener('resize', resize)

    // ── Desenho ──────────────────────────────────────────────────────

    const drawBolt = (t: number): void => {
      const { w, h } = sizeRef.current
      const cx = w / 2
      const topY = -24
      const endY = h / 2
      const segments = 12
      const alphaIn = clamp01((t - BOLT_START) / 70)
      const alphaOut = clamp01((BOLT_END + 5 - t) / 70)
      const alpha = alphaIn * alphaOut
      if (alpha <= 0.02) return

      // Polilinha irregular: jitter horizontal DECRESCENTE perto do centro.
      const points: { x: number; y: number }[] = []
      const maxJitter = Math.min(w, 1100) * 0.055
      for (let i = 0; i <= segments; i += 1) {
        const p = i / segments
        const y = topY + (endY - topY) * p
        const jitter = Math.pow(1 - p, 1.4) * maxJitter + 1.5
        const x = i === 0 || i === segments ? cx : cx + (Math.random() - 0.5) * 2 * jitter
        points.push({ x, y })
      }

      const passes: { width: number; style: string; blur: number; shadow: string }[] = [
        { width: 9, style: 'rgba(188, 19, 254, 0.55)', blur: 42, shadow: '#bc13fe' }, // halo violeta
        { width: 4.5, style: 'rgba(0, 243, 255, 0.7)', blur: 28, shadow: '#00f3ff' }, // halo cyan
        { width: 2.1, style: 'rgba(255, 255, 255, 0.95)', blur: 16, shadow: '#ffffff' } // núcleo branco
      ]
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      for (const pass of passes) {
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y)
        ctx.strokeStyle = pass.style
        ctx.lineWidth = pass.width
        ctx.shadowColor = pass.shadow
        ctx.shadowBlur = pass.blur
        ctx.stroke()
      }
      ctx.restore()
    }

    const spawnImpact = (t: number): void => {
      const { w, h } = sizeRef.current
      const cx = w / 2
      const cy = h / 2
      const minDim = Math.min(w, h)
      // 3 anéis de choque concêntricos desalinhados.
      ringsRef.current = [
        {
          delay: 0,
          maxR: minDim * 0.52,
          lineWidth: 7,
          color: 'rgba(0, 243, 255, 0.9)',
          glow: '#00f3ff'
        },
        {
          delay: 80,
          maxR: minDim * 0.68,
          lineWidth: 5,
          color: 'rgba(188, 19, 254, 0.85)',
          glow: '#bc13fe'
        },
        {
          delay: 160,
          maxR: minDim * 0.4,
          lineWidth: 3.5,
          color: 'rgba(255, 255, 255, 0.9)',
          glow: '#ffffff'
        }
      ]
      // 3–5 arcos laterais curtos partindo do centro.
      const arcCount = 3 + Math.floor(Math.random() * 3)
      arcsRef.current = Array.from({ length: arcCount }, (_, i) => {
        const base = (Math.PI * 2 * i) / arcCount + Math.random() * 0.9
        return {
          angle: base,
          length: 70 + Math.random() * 110,
          born: t,
          offsets: Array.from({ length: 6 }, () => (Math.random() - 0.5) * 46)
        }
      })
      // 24–36 faíscas com velocidade radial aleatória e gravidade leve.
      const sparkCount = 24 + Math.floor(Math.random() * 13)
      sparksRef.current.push(
        ...Array.from({ length: sparkCount }, () => {
          const angle = Math.random() * Math.PI * 2
          const speed = 130 + Math.random() * 420
          return {
            x: cx,
            y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 90,
            born: t,
            life: 650 + Math.random() * 550,
            size: 1.4 + Math.random() * 2.6,
            gravity: 380,
            cyan: Math.random() < 0.6
          }
        })
      )
    }

    const updateAndDrawSparks = (t: number, dt: number, decayFade: number): void => {
      if (sparksRef.current.length === 0) return
      const dtSec = dt / 1000
      const alive: Spark[] = []
      for (const spark of sparksRef.current) {
        const age = t - spark.born
        if (age >= spark.life) continue
        spark.vy += spark.gravity * dtSec
        spark.x += spark.vx * dtSec
        spark.y += spark.vy * dtSec
        const lifeP = 1 - age / spark.life
        const alpha = Math.pow(lifeP, 1.3) * decayFade
        ctx.globalAlpha = alpha
        ctx.fillStyle = spark.cyan ? '#a8fbff' : '#ffffff'
        ctx.shadowColor = spark.cyan ? '#00f3ff' : '#ffffff'
        ctx.shadowBlur = 7
        ctx.beginPath()
        ctx.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2)
        ctx.fill()
        alive.push(spark)
      }
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
      sparksRef.current = alive
    }

    const drawRingsAndFlash = (t: number, decayFade: number): void => {
      const { w, h, maxR } = sizeRef.current
      const cx = w / 2
      const cy = h / 2

      // Flash branco central (1000–1350): gradiente radial expandindo e morrendo.
      if (t >= IMPACT_AT && t < IMPACT_END) {
        const p = clamp01((t - IMPACT_AT) / (IMPACT_END - IMPACT_AT))
        const radius = 32 + easeOutCubic(p) * 280
        const alpha = (1 - p) * 0.95
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
        gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
        gradient.addColorStop(0.35, `rgba(220, 245, 255, ${alpha * 0.75})`)
        gradient.addColorStop(1, 'rgba(160, 220, 255, 0)')
        ctx.save()
        ctx.fillStyle = gradient
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
        ctx.restore()
      }

      // Anéis de choque.
      for (const ring of ringsRef.current) {
        const p = clamp01((t - IMPACT_AT - ring.delay) / 520)
        if (p <= 0 || p >= 1) continue
        const radius = 22 + easeOutCubic(p) * Math.min(ring.maxR, maxR)
        ctx.save()
        ctx.globalAlpha = (1 - p) * 0.9 * decayFade
        ctx.strokeStyle = ring.color
        ctx.lineWidth = ring.lineWidth * (1 - p) + 1.2
        ctx.shadowColor = ring.glow
        ctx.shadowBlur = 26
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      // Arcos laterais (vida ~250 ms).
      const ARC_LIFE = 250
      for (const arc of arcsRef.current) {
        const age = t - arc.born
        if (age < 0 || age > ARC_LIFE) continue
        const p = age / ARC_LIFE
        const alpha = (1 - p) * 0.9 * decayFade
        const steps = arc.offsets.length + 1
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.strokeStyle = 'rgba(210, 250, 255, 0.95)'
        ctx.lineWidth = 1.8
        ctx.shadowColor = '#00f3ff'
        ctx.shadowBlur = 18
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        for (let i = 0; i < steps; i += 1) {
          const q = (i + 1) / steps
          const dist = arc.length * q
          const perp = arc.angle + Math.PI / 2
          const offset = i < arc.offsets.length ? arc.offsets[i] * (1 - q * 0.5) : 0
          ctx.lineTo(
            cx + Math.cos(arc.angle) * dist + Math.cos(perp) * offset,
            cy + Math.sin(arc.angle) * dist + Math.sin(perp) * offset
          )
        }
        ctx.stroke()
        ctx.restore()
      }
    }

    const drawWave = (t: number): void => {
      const { w, h, maxR } = sizeRef.current
      const cx = w / 2
      const cy = h / 2
      const p = clamp01((t - WAVE_START) / (WAVE_END - WAVE_START))
      const front = easeOutCubic(p) * maxR
      if (front <= 2) return
      const fade = 1 - easeOutCubic(p) * 0.45

      const strokeFront = (
        radius: number,
        width: number,
        style: string,
        blur: number,
        shadow: string,
        alpha: number
      ): void => {
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.strokeStyle = style
        ctx.lineWidth = width
        ctx.shadowColor = shadow
        ctx.shadowBlur = blur
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      // Frente principal: borda cyan cromática + núcleo branco.
      strokeFront(front, 11, 'rgba(0, 243, 255, 0.85)', 46, '#00f3ff', 0.8 * fade)
      strokeFront(front, 4.2, 'rgba(255, 255, 255, 0.95)', 22, '#ffffff', 0.95 * fade)
      // Frente secundária (eco) atrasada e mais fraca.
      if (front > maxR * 0.14) {
        strokeFront(front * 0.8, 6, 'rgba(188, 19, 254, 0.7)', 32, '#bc13fe', 0.45 * fade)
      }

      // Partículas adensadas na borda da frente de onda.
      for (let i = 0; i < 3; i += 1) {
        const angle = Math.random() * Math.PI * 2
        const speed = 80 + Math.random() * 90
        sparksRef.current.push({
          x: cx + Math.cos(angle) * (front + Math.random() * 10 - 5),
          y: cy + Math.sin(angle) * (front + Math.random() * 10 - 5),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          born: t,
          life: 380 + Math.random() * 220,
          size: 1.1 + Math.random() * 2.1,
          gravity: 0,
          cyan: Math.random() < 0.75
        })
      }
    }

    const updateMask = (t: number): void => {
      if (flagsRef.current.maskCleared) return
      const bgNode = backgroundRef.current
      if (!bgNode) return
      if (t < REVEAL_START) return
      const { maxR } = sizeRef.current
      const p = clamp01((t - REVEAL_START) / (REVEAL_END - REVEAL_START))
      const radius = REVEAL_FROM + easeOutCubic(p) * (maxR - REVEAL_FROM)
      if (t >= REVEAL_END + 60) {
        bgNode.style.maskImage = 'none'
        bgNode.style.setProperty('-webkit-mask-image', 'none')
        flagsRef.current.maskCleared = true
        return
      }
      // Mesma curva da frente de onda — a revelação acompanha o choque.
      const image = `radial-gradient(circle at 50% 50%, black ${radius}px, transparent ${radius}px)`
      bgNode.style.maskImage = image
      bgNode.style.setProperty('-webkit-mask-image', image)
    }

    // SKIP por gamepad: qualquer botão com borda de pressão encerra tudo.
    const pollGamepadSkip = (): boolean => {
      try {
        const pads = navigator.getGamepads?.() ?? []
        let anyDown = false
        for (const pad of pads) {
          if (!pad) continue
          for (const button of pad.buttons) {
            if (button && (button.pressed || button.value > 0.5)) {
              anyDown = true
              break
            }
          }
          if (anyDown) break
        }
        if (gamepadBaselineRef.current === null) {
          gamepadBaselineRef.current = anyDown
          return false
        }
        const rising = anyDown && !gamepadBaselineRef.current
        gamepadBaselineRef.current = anyDown
        return rising
      } catch {
        return false
      }
    }

    const loop = (now: number): void => {
      const t = now - t0Ref.current
      const dt = Math.min(50, now - lastRef.current)
      lastRef.current = now

      // Disparos únicos por fase (SFX + spawn de impacto).
      if (!flagsRef.current.zap && t >= BOLT_START) {
        flagsRef.current.zap = true
        playSfx('zap')
      }
      if (!flagsRef.current.impact && t >= IMPACT_AT) {
        flagsRef.current.impact = true
        spawnImpact(t)
        playSfx('impact')
      }
      if (!flagsRef.current.wave && t >= WAVE_START) {
        flagsRef.current.wave = true
        playSfx('wave')
      }
      if (!flagsRef.current.home && t >= HOME_REVEAL_AT) {
        flagsRef.current.home = true
        playSfx('open')
        callbacksRef.current.onHomeReveal()
      }

      const decayFade =
        t > DECAY_START ? clamp01(1 - (t - DECAY_START) / (DECAY_END - DECAY_START)) : 1

      const { w, h } = sizeRef.current
      ctx.clearRect(0, 0, w, h)
      if (t >= BOLT_START && t < BOLT_END + 50) drawBolt(t)
      if (t >= IMPACT_AT) {
        drawRingsAndFlash(t, decayFade)
        updateAndDrawSparks(t, dt, decayFade)
      }
      if (t >= WAVE_START && t < WAVE_END + 140) drawWave(t)
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0

      updateMask(t)

      // Fase 6: overlay residual esmaece (0.85 → 0.15).
      if (t >= DECAY_START && darkRef.current) {
        if (darkRef.current.style.transition !== 'none') {
          darkRef.current.style.transition = 'none'
        }
        const p = easeInOutSine((t - DECAY_START) / (DECAY_END - DECAY_START))
        darkRef.current.style.opacity = (0.85 - 0.7 * p).toFixed(3)
      }

      if (pollGamepadSkip()) {
        skip()
        return
      }

      if (t >= FADE_END) {
        finish()
        return
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)

    return (): void => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(rafRef.current)
      clearTimers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {/* Fase 1/6 — escurecimento (acima do fundo, abaixo do canvas) */}
      <div
        ref={darkRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-20 bg-black"
        style={{ opacity: 0, transition: 'opacity 400ms ease-out' }}
      />
      {/* Fases 2–7 — raio / choque / onda (SKIP: clique em qualquer lugar) */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 z-30 cursor-pointer"
        style={{ touchAction: 'none' }}
        onPointerDown={skip}
      />
    </>
  )
}
