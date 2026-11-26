import { Color, Group, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import type { AvatarState, AvatarTheme } from '../../../../shared/avatar'
import {
  AVATAR_ERROR_ACCENT,
  DEFAULT_AVATAR_ACCENT,
  clampAvatarLevel
} from '../../../../shared/avatar'
import { normalizeTheme, type ThemeConfig } from '../../../../shared/theme'
import { buildCaterpillar } from './caterpillar'
import type { CaterpillarBuild, CaterpillarOutfit, CaterpillarStyle } from './caterpillar'
import { resolveCaterpillarOutfit, resolveCaterpillarStyle } from './caterpillar'
import { createExpressionEngine } from './expressions'
import { createContextLossGuard, detectWebGLBackend } from './fallback'
import { createHoloMaterial } from './holoMaterial'
import type { AvatarLook } from './looks'
import { resolveAvatarLook } from './looks'
import { createLipSync } from './lipSync'
import { ABSOLEM_1951_PALETTE } from './palettes'
import { createRoleMaterialFactory } from './roleMaterials'
import { createParticles, PARTICLE_MAX } from './particles'
import { createPerfMonitor } from './perf'
import type { DegradationStep } from './perf'
import type { ParticleSystem } from './particles'
import { createRenderLoop } from './renderLoop'
import { toAvatarParams } from './themeAdapter'
import type { AvatarParams } from './themeAdapter'

/**
 * Bootstrap da cena do avatar.
 *
 * Responsabilidades: criar o `WebGLRenderer` com fundo transparente, a câmera,
 * o relógio real (delta vindo do `requestAnimationFrame`), a lagarta, o shader
 * de holograma, as partículas e o ciclo de vida do loop, que só roda com o
 * overlay visível e a página visível. As expressões (T5), o lip-sync (T6) e a
 * degradação (T7) entram nas etapas seguintes.
 *
 * Nada aqui é importado pela rota da janela principal: este módulo só chega ao
 * browser pelo `import()` dinâmico de `overlay/avatar/index.ts`.
 */
export interface AvatarMetrics {
  fps: number
  frameMs: number
  drawCalls: number
  triangles: number
  /** Nível de degradação vigente (0..3), exposto no HUD de debug. */
  degradation: number
}

export interface AvatarSceneOptions {
  state?: AvatarState
  level?: number
  theme?: AvatarTheme
  /** Tema completo (task 04); tem precedência sobre `theme.accent`. */
  themeConfig?: ThemeConfig
  style?: CaterpillarStyle | string
  outfit?: CaterpillarOutfit | string
  seed?: number
  /** Acabamento do personagem (`holo` ou `storybook`). */
  look?: AvatarLook | string
  /** Visibilidade do overlay (push `overlay:status-changed`). */
  visible?: boolean
  reducedMotion?: boolean
  /** Preview: metade das partículas (0.5) sem mudar o tema. */
  particleScale?: number
  /** Preview: `pixelRatio` fixo em 1. */
  pixelRatioCap?: number
  /** Força a degradação automática (flag `?slow=1`). */
  slow?: boolean
  debug?: boolean
  onFallback?: (reason: string) => void
  onDegrade?: (level: number) => void
}

export interface AvatarHandle {
  readonly canvas: HTMLCanvasElement
  setState: (state: AvatarState) => void
  setLevel: (level: number) => void
  /** Compatibilidade da task 03: troca só a cor principal. */
  setTheme: (theme: AvatarTheme) => void
  /** Task 04: aplica o tema completo sem reiniciar renderer/câmera/loop. */
  applyTheme: (theme: ThemeConfig) => void
  setVisible: (visible: boolean) => void
  setReducedMotion: (reduced: boolean) => void
  resize: () => void
  dispose: () => void
  getMetrics: () => AvatarMetrics
  getState: () => AvatarState
  isRunning: () => boolean
}

const ZERO_METRICS: AvatarMetrics = {
  fps: 0,
  frameMs: 0,
  drawCalls: 0,
  triangles: 0,
  degradation: 0
}
const METRIC_WINDOW = 90

function fallbackHandle(
  canvas: HTMLCanvasElement,
  reason: string,
  onFallback: ((reason: string) => void) | undefined
): AvatarHandle {
  console.warn('avatar: fallback', reason)
  onFallback?.(reason)
  return {
    canvas,
    setState: () => {},
    setLevel: () => {},
    setTheme: () => {},
    applyTheme: () => {},
    setVisible: () => {},
    setReducedMotion: () => {},
    resize: () => {},
    dispose: () => {},
    getMetrics: () => ({ ...ZERO_METRICS }),
    getState: () => 'idle',
    isRunning: () => false
  }
}

export function createAvatarScene(
  canvas: HTMLCanvasElement,
  options: AvatarSceneOptions = {}
): AvatarHandle {
  if (detectWebGLBackend(canvas) === 'fallback') {
    return fallbackHandle(canvas, 'webgl-indisponivel', options.onFallback)
  }

  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: (window.devicePixelRatio ?? 1) <= 1.5,
      powerPreference: 'low-power',
      premultipliedAlpha: true
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return fallbackHandle(canvas, `webgl-renderer: ${detail}`, options.onFallback)
  }

  const scene = new Scene()
  const camera = new PerspectiveCamera(42, 1, 0.1, 50)
  camera.position.set(0, 0.15, 3.8)
  camera.lookAt(0, 0, 0)

  const root = new Group()
  root.scale.setScalar(0.92)
  scene.add(root)

  const initialTheme =
    options.themeConfig ??
    normalizeTheme({
      primaryColor: options.theme?.accent ?? DEFAULT_AVATAR_ACCENT,
      effectColor: options.theme?.accent ?? DEFAULT_AVATAR_ACCENT
    })
  let params: AvatarParams = toAvatarParams(initialTheme)
  let currentStyle = resolveCaterpillarStyle(options.style ?? params.style)
  let currentOutfit = resolveCaterpillarOutfit(options.outfit ?? params.outfit)
  const particleScale = Math.max(0, options.particleScale ?? 1)
  let reducedMotion = options.reducedMotion === true || params.reducedMotion
  root.scale.setScalar(0.92 * params.scale)

  const holoMaterial = createHoloMaterial({
    color: params.primary.hex,
    intensity: params.materials.hologramIntensity,
    noise: params.materials.noise
  })
  // Pupilas e boca são "buracos" escuros: blending normal lê melhor que aditivo.
  const darkMaterial = new MeshBasicMaterial({
    color: new Color(params.shadow.hex),
    transparent: true,
    opacity: 0.92
  })
  const look = resolveAvatarLook(options.look)
  let roleMaterials = createRoleMaterialFactory({
    look,
    palette: ABSOLEM_1951_PALETTE,
    holo: holoMaterial,
    dark: darkMaterial
  })
  let materialFor = roleMaterials.materialFor

  let caterpillar: CaterpillarBuild = buildCaterpillar({
    style: currentStyle,
    outfit: currentOutfit,
    accessories: params.accessories,
    seed: options.seed,
    material: materialFor
  })
  root.add(caterpillar.root)

  const particles: ParticleSystem = createParticles({
    // Capacidade máxima: a troca de densidade do tema só muda o draw range,
    // sem realocar buffers nem recriar a cena.
    count: PARTICLE_MAX,
    color: params.effect.hex,
    seed: options.seed,
    reducedMotion
  })
  particles.setCount(Math.round(params.particles.count * particleScale))
  root.add(particles.points)

  const expressions = createExpressionEngine()
  const lipSync = createLipSync()
  const primaryColor = new Color(params.primary.hex)
  const effectColor = new Color(params.effect.hex)
  const errorColor = new Color(AVATAR_ERROR_ACCENT)
  const blendedColor = new Color()
  const particleColor = new Color()

  let state: AvatarState = options.state ?? 'idle'
  if (state !== 'idle') {
    expressions.setState(state)
    lipSync.setState(state)
  }
  lipSync.setLevel(clampAvatarLevel(options.level))
  let overlayVisible = options.visible ?? true
  let pageVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden'
  let disposed = false

  const frameTimes: number[] = []
  let drawCalls = 0
  let triangles = 0
  let elapsedSeconds = 0
  let pixelRatioCap = Math.min(options.pixelRatioCap ?? window.devicePixelRatio ?? 1, 2)
  let slowTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Reconstrução parcial: só a malha da lagarta (estilo/roupa/acessórios). O
   * renderer, a câmera, os materiais, as partículas e o loop continuam os
   * mesmos, o que mantém a troca de tema abaixo de ~50 ms.
   *
   * A fábrica de materiais por papel é recriada a cada rebuild para liberar os
   * materiais do acabamento sólido; `holoMaterial` e `darkMaterial` são da cena
   * e nunca são descartados aqui.
   */
  function rebuildCaterpillar(minimal = false): void {
    roleMaterials.dispose()
    roleMaterials = createRoleMaterialFactory({
      look,
      palette: ABSOLEM_1951_PALETTE,
      holo: holoMaterial,
      dark: darkMaterial
    })
    materialFor = roleMaterials.materialFor

    const next = buildCaterpillar({
      style: currentStyle,
      outfit: currentOutfit,
      accessories: params.accessories,
      seed: options.seed,
      material: materialFor,
      ...(minimal ? { minimal: true } : {})
    })
    root.remove(caterpillar.root)
    caterpillar.dispose()
    caterpillar = next
    root.add(caterpillar.root)
  }

  function applyDegradation(level: number, step: DegradationStep): void {
    if (level === 1) {
      pixelRatioCap = 1
      resize()
    } else if (level === 2) {
      particles.setCount(Math.round(particles.count() / 2))
    } else if (level === 3) {
      holoMaterial.uniforms.uNoise.value = 0
      rebuildCaterpillar(true)
    }
    // Uma linha por nível: o monitor garante que cada passo é aplicado/logado
    // uma única vez.
    console.info('avatar: degradacao', level, step.detail)
    options.onDegrade?.(level)
  }

  const perf = createPerfMonitor({ onDegrade: applyDegradation })

  const loop = createRenderLoop({
    raf: (callback) => window.requestAnimationFrame(callback),
    cancel: (handle) => window.cancelAnimationFrame(handle),
    onFrame: (delta) => {
      elapsedSeconds += delta
      // Movimento reduzido: uniform de tempo congelado (sem scanline/ruído em
      // movimento) e nenhuma partícula; o estado ainda pode mudar.
      const motionTime = reducedMotion ? 0 : elapsedSeconds
      const expression = expressions.update(delta)
      const lip = lipSync.update(delta)
      state = expressions.getState()

      holoMaterial.uniforms.uTime.value = motionTime

      // As expressões só se movem quando há tempo de animação; `reducedMotion`
      // congela o sway sem impedir a troca de estado.
      caterpillar.root.rotation.y = Math.sin(motionTime * 0.45) * 0.07 * expression.sway
      caterpillar.root.rotation.z = expression.headTilt * (reducedMotion ? 0 : 1)
      caterpillar.body.rotation.z = Math.sin(motionTime * 0.8) * 0.025 * expression.sway
      for (let index = 0; index < caterpillar.eyeGroups.length; index += 1) {
        caterpillar.eyeGroups[index].scale.y = Math.max(0.06, expression.eyeOpenness)
      }
      for (let index = 0; index < caterpillar.antennae.length; index += 1) {
        const side = index === 0 ? 1 : -1
        caterpillar.antennae[index].rotation.z = side * (0.18 + expression.antennaLift * 0.32)
      }

      blendedColor.copy(primaryColor).lerp(errorColor, expression.alert)
      ;(holoMaterial.uniforms.uColor.value as Color).copy(blendedColor)
      holoMaterial.uniforms.uIntensity.value =
        (0.4 + params.glowIntensity * 0.6) * (0.78 + expression.pulse * 0.42)
      particleColor.copy(effectColor).lerp(errorColor, expression.alert)
      particles.setColor(particleColor)
      particles.setSpeed(expression.particleSpeed)
      particles.setOpacity(0.32 + lip.aura * 0.58)
      caterpillar.mouth.scale.y = 0.3 + lip.mouthOpen * 1.35
      caterpillar.mouth.scale.x = 0.55 * (0.85 + lip.mouthWidth * 0.3)
      particles.update(motionTime)

      renderer.render(scene, camera)
      drawCalls = renderer.info.render.calls
      triangles = renderer.info.render.triangles

      if (delta > 0) {
        perf.reportFrame(delta * 1000)
        frameTimes.push(delta * 1000)
        if (frameTimes.length > METRIC_WINDOW) frameTimes.shift()
      }
    }
  })

  const contextGuard = createContextLossGuard({
    recreate: () => renderer.forceContextRestore(),
    onFallback: (reason) => {
      loop.stop()
      resetMetrics()
      console.warn('avatar: fallback', reason)
      options.onFallback?.(reason)
    }
  })
  const onContextLost = (event: Event): void => {
    contextGuard.handleLost(event)
  }
  const onContextRestored = (): void => {
    contextGuard.handleRestored()
    syncRunning()
  }
  canvas.addEventListener('webglcontextlost', onContextLost)
  canvas.addEventListener('webglcontextrestored', onContextRestored)

  function resize(): void {
    if (disposed) return
    const width = Math.max(1, canvas.clientWidth || canvas.width || 64)
    const height = Math.max(1, canvas.clientHeight || canvas.height || 64)
    renderer.setPixelRatio(pixelRatioCap)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  function resetMetrics(): void {
    frameTimes.length = 0
    drawCalls = 0
    triangles = 0
  }

  function syncRunning(): void {
    if (disposed) return
    if (overlayVisible && pageVisible) {
      loop.start()
    } else {
      loop.stop()
      resetMetrics()
    }
  }

  const onVisibilityChange = (): void => {
    pageVisible = document.visibilityState !== 'hidden'
    syncRunning()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  const onWindowResize = (): void => resize()
  window.addEventListener('resize', onWindowResize)

  // Fundo transparente: o overlay nunca pinta um retângulo atrás do avatar.
  renderer.setClearColor(0x000000, 0)
  resize()
  syncRunning()

  if (options.slow) {
    // Flag de desenvolvimento: percorre os três passos em ~2 s, sem esperar
    // as janelas reais de 2 s por nível.
    slowTimer = setInterval(() => {
      if (perf.getLevel() >= 3) {
        if (slowTimer) clearInterval(slowTimer)
        slowTimer = null
        return
      }
      perf.forceDegrade()
    }, 700)
  }

  return {
    canvas,
    setState(next: AvatarState): void {
      state = next
      expressions.setState(next)
      lipSync.setState(next)
    },
    setLevel(next: number): void {
      lipSync.setLevel(clampAvatarLevel(next))
    },
    setTheme(theme: AvatarTheme): void {
      primaryColor.set(theme.accent)
    },
    applyTheme(theme: ThemeConfig): void {
      const next = toAvatarParams(theme)
      const styleChanged = next.style !== currentStyle
      const outfitChanged = next.outfit !== currentOutfit
      const accessoriesChanged = next.accessories.join('|') !== params.accessories.join('|')

      currentStyle = next.style
      currentOutfit = next.outfit
      params = next

      primaryColor.set(next.primary.hex)
      effectColor.set(next.effect.hex)
      darkMaterial.color.set(next.shadow.hex)
      holoMaterial.uniforms.uNoise.value = next.materials.noise
      root.scale.setScalar(0.92 * next.scale)

      reducedMotion = next.reducedMotion
      particles.setReducedMotion(reducedMotion)
      particles.setCount(Math.round(next.particles.count * particleScale))

      if (styleChanged || outfitChanged || accessoriesChanged) rebuildCaterpillar()
    },
    setVisible(visible: boolean): void {
      overlayVisible = visible
      syncRunning()
    },
    setReducedMotion(reduced: boolean): void {
      reducedMotion = reduced
      particles.setReducedMotion(reduced)
      if (!reduced && perf.getLevel() >= 2) {
        particles.setCount(Math.round(particles.count() / 2))
      }
    },
    resize,
    dispose(): void {
      if (disposed) return
      disposed = true
      loop.stop()
      if (slowTimer) clearInterval(slowTimer)
      slowTimer = null
      contextGuard.dispose()
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('resize', onWindowResize)
      root.remove(caterpillar.root)
      root.remove(particles.points)
      caterpillar.dispose()
      particles.dispose()
      roleMaterials.dispose()
      holoMaterial.dispose()
      darkMaterial.dispose()
      renderer.dispose()
      resetMetrics()
    },
    getMetrics(): AvatarMetrics {
      const degradation = perf.getLevel()
      if (!loop.isRunning() || frameTimes.length === 0) {
        return { ...ZERO_METRICS, degradation }
      }
      const total = frameTimes.reduce((sum, value) => sum + value, 0)
      const frameMs = total / frameTimes.length
      return {
        fps: frameMs > 0 ? Math.round((1000 / frameMs) * 10) / 10 : 0,
        frameMs: Math.round(frameMs * 10) / 10,
        drawCalls,
        triangles,
        degradation
      }
    },
    getState(): AvatarState {
      return state
    },
    isRunning(): boolean {
      return loop.isRunning()
    }
  }
}
