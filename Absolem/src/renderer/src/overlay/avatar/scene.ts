import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer
} from 'three'
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
import { applyExpressionFrame, createExpressionBase } from './expressionMapping'
import type { ExpressionBasePose, ExpressionChannels, ExpressionRig } from './expressionMapping'
import { createContextLossGuard, detectWebGLBackend } from './fallback'
import { createHoloMaterial } from './holoMaterial'
import type { AvatarLook } from './looks'
import { resolveAvatarLook } from './looks'
import { createLipSync } from './lipSync'
import { applyLookToScene, resolveToneMapping } from './lookScene'
import { applyThemeChange } from './sceneTheme'
import { ABSOLEM_1951_PALETTE } from './palettes'
import { createRoleMaterialFactory } from './roleMaterials'
import {
  STORYBOOK_AMBIENT_INTENSITY,
  STORYBOOK_DIRECTIONAL_INTENSITY,
  STORYBOOK_DIRECTIONAL_POSITION,
  createToonGradient,
  shouldCreateStorybookLights
} from './toonGradient'
import type { ToonGradient } from './toonGradient'
import {
  DEFAULT_OUTLINE_STRENGTH,
  OUTLINE_PART_GROUPS,
  addOutlines,
  clampOutlineStrength,
  removeOutlines
} from './outline'
import type { OutlineHandle } from './outline'
import { EYELID_OPEN_ROTATION } from './parts/head'
import { createParticles, PARTICLE_MAX } from './particles'
import {
  bodySway,
  breatheAmount,
  headMicroTilt,
  restSway,
  smokeStrengthForState
} from './restMotion'
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
  /** Contorno (task 19): força 0..1; 0 desliga; default 0.7. Sem campo de tema. */
  outlineStrength?: number
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
  /** Task 19: ajusta a força do contorno; 0 desliga; reconstrói contorno. */
  setOutlineStrength: (strength: number) => void
  /** Task 19: troca de acabamento ao vivo sem recriar renderer/câmera/loop. */
  setLook: (look: AvatarLook | string) => void
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
    setOutlineStrength: () => {},
    setLook: () => {},
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
  // Contorno (task 19): força fixa 0.7 por default; 0 desliga. Sem novo campo
  // de tema (task 21 expõe). Só no acabamento ilustrado.
  let outlineStrength = clampOutlineStrength(options.outlineStrength ?? DEFAULT_OUTLINE_STRENGTH)
  let outlines: OutlineHandle[] = []
  // Nível de degradação 2 remove contorno de partes pequenas (task 19, T5).
  let smallOutlinesRemoved = false
  // Nível de degradação 3 remove todo o contorno (task 19, T5).
  let outlinesRemoved = false
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
  let look: AvatarLook = resolveAvatarLook(options.look)
  // Rampa toon de 4 níveis (task 19): `DataTexture` nativo, sem asset; dona é a cena.
  const toonGradient: ToonGradient = createToonGradient()
  let roleMaterials = createRoleMaterialFactory({
    look,
    palette: ABSOLEM_1951_PALETTE,
    holo: holoMaterial,
    dark: darkMaterial,
    gradientMap: toonGradient.texture
  })
  let materialFor = roleMaterials.materialFor

  // Luzes só no acabamento ilustrado (task 19): ambiente + direcional,
  // esquerda/cima/frente, sem sombras. No `holo` nenhuma luz é adicionada.
  const ambientLight = new AmbientLight(0xffffff, STORYBOOK_AMBIENT_INTENSITY)
  const directionalLight = new DirectionalLight(0xffffff, STORYBOOK_DIRECTIONAL_INTENSITY)
  directionalLight.position.set(
    STORYBOOK_DIRECTIONAL_POSITION[0],
    STORYBOOK_DIRECTIONAL_POSITION[1],
    STORYBOOK_DIRECTIONAL_POSITION[2]
  )
  directionalLight.castShadow = false
  const storybookLights = new Group()
  storybookLights.name = 'caterpillar-storybook-lights'
  storybookLights.add(ambientLight, directionalLight)

  let caterpillar: CaterpillarBuild = buildCaterpillar({
    style: currentStyle,
    outfit: currentOutfit,
    accessories: params.accessories,
    seed: options.seed,
    material: materialFor
  })
  root.add(caterpillar.root)
  if (shouldCreateStorybookLights(look)) scene.add(storybookLights)
  // Tone mapping só no acabamento ilustrado; `holo` permanece `NoToneMapping`.
  renderer.toneMapping = resolveToneMapping(look)
  caterpillar.smoke.setReducedMotion(reducedMotion)
  caterpillar.root.updateWorldMatrix(true, true)
  applyOutlines({ includeSmall: true })

  // Pose base do rosto capturada uma vez por build; o laço escreve valores
  // absolutos a partir dela, sem acumular deslocamento frame a frame.
  let expressionRig = captureExpressionRig(caterpillar)
  let expressionBase = captureExpressionBase(expressionRig)
  const expressionChannels: ExpressionChannels = {
    lidClosure: 0,
    browRaise: 0,
    browFurrow: 0,
    lookAside: 0,
    mouthOpen: 0,
    mouthWidth: 0.5,
    smile: 0,
    breathe: 0,
    antennaLift: 0
  }

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

  /** Referências mutáveis dos nós animados; listas vazias são aceitas. */
  function captureExpressionRig(build: CaterpillarBuild): ExpressionRig {
    return {
      lids: build.lids,
      brows: build.brows,
      pupils: build.pupils,
      mouthCorners: build.mouthCorners,
      jaw: build.jaw,
      mouth: build.mouth,
      upperLip: build.mouth.getObjectByName('caterpillar-lip-upper') ?? null,
      body: build.body,
      turbanTassel: build.turbanTassel
    }
  }

  function captureExpressionBase(rig: ExpressionRig): ExpressionBasePose {
    const base = createExpressionBase(rig)
    // A pálpebra nasce na rotação de repouso; o mapa parte da pose aberta e
    // soma o curso até a fechada.
    for (const lid of base.lids) lid.rotation.x = EYELID_OPEN_ROTATION
    return base
  }

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
      dark: darkMaterial,
      gradientMap: toonGradient.texture
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
    // Contorno removido antes de liberar a malha antiga; nunca vaza.
    clearOutlines()
    root.remove(caterpillar.root)
    caterpillar.dispose()
    caterpillar = next
    root.add(caterpillar.root)
    // A pose base é recapturada no rebuild; nenhuma posição antiga vaza.
    expressionRig = captureExpressionRig(caterpillar)
    expressionBase = captureExpressionBase(expressionRig)
    // A baforada não é essencial: no modo mínimo ela não é desenhada, mesmo
    // que `prefers-reduced-motion` esteja desligado.
    caterpillar.smoke.setReducedMotion(reducedMotion || minimal)
    applyOutlines({ includeSmall: !smallOutlinesRemoved })
  }

  /** Remove e libera todos os contornos atuais. */
  function clearOutlines(): void {
    for (const handle of outlines) handle.dispose()
    outlines = []
    // `removeOutlines` garante limpeza de filhos órfãos (idempotente).
    removeOutlines(root)
  }

  /** Atualiza cores dos materiais existentes sem recriar a malha. */
  function syncMaterialColors(): void {
    roleMaterials.setPalette(ABSOLEM_1951_PALETTE)
    darkMaterial.color.set(params.shadow.hex)
    ;(holoMaterial.uniforms.uColor.value as Color).set(params.primary.hex)
  }

  /** Aplica contorno só nos grupos de silhueta, conforme acabamento e força. */
  function applyOutlines(opts: { includeSmall: boolean }): void {
    clearOutlines()
    if (look !== 'storybook' || outlineStrength <= 0 || outlinesRemoved) return
    for (const partName of OUTLINE_PART_GROUPS) {
      const group = caterpillar.parts[partName]
      if (!group) continue
      group.updateWorldMatrix(true, true)
      const created = addOutlines(group, { outlineStrength })
      for (const handle of created) {
        if (!opts.includeSmall && handle.small) {
          handle.dispose()
          continue
        }
        outlines.push(handle)
      }
    }
  }

  function applyDegradation(level: number, step: DegradationStep): void {
    if (level === 1) {
      pixelRatioCap = 1
      resize()
    } else if (level === 2) {
      particles.setCount(Math.round(particles.count() / 2))
      // Nível 2: remove contorno de partes pequenas.
      smallOutlinesRemoved = true
      applyOutlines({ includeSmall: false })
    } else if (level === 3) {
      holoMaterial.uniforms.uNoise.value = 0
      // Nível 3: remove todo o contorno.
      outlinesRemoved = true
      clearOutlines()
      // Nível 3: reduz a luz direcional para ambiente apenas.
      directionalLight.removeFromParent()
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
      caterpillar.root.rotation.y = restSway(motionTime, expression.sway, reducedMotion)
      caterpillar.root.rotation.z =
        expression.headTilt * (reducedMotion ? 0 : 1) + headMicroTilt(motionTime, reducedMotion)
      caterpillar.body.rotation.z = bodySway(motionTime, expression.sway, reducedMotion)

      expressionChannels.lidClosure = expression.lidClosure
      expressionChannels.browRaise = expression.browRaise
      expressionChannels.browFurrow = expression.browFurrow
      expressionChannels.lookAside = expression.lookAside
      expressionChannels.mouthOpen = lip.mouthOpen
      expressionChannels.mouthWidth = lip.mouthWidth
      expressionChannels.smile = expression.smile
      expressionChannels.breathe = breatheAmount(expression.breathe, motionTime, reducedMotion)
      expressionChannels.antennaLift = expression.antennaLift
      applyExpressionFrame(expressionRig, expressionBase, expressionChannels)

      // A fala interrompe a baforada; em repouso ela sobe devagar e em
      // `thinking` fica mais forte, como na referência.
      caterpillar.smoke.setStrength(
        smokeStrengthForState(state, expression.smokeStrength, reducedMotion)
      )
      caterpillar.smoke.update(motionTime)

      blendedColor.copy(primaryColor).lerp(errorColor, expression.alert)
      ;(holoMaterial.uniforms.uColor.value as Color).copy(blendedColor)
      holoMaterial.uniforms.uIntensity.value =
        (0.4 + params.glowIntensity * 0.6) * (0.78 + expression.pulse * 0.42)
      particleColor.copy(effectColor).lerp(errorColor, expression.alert)
      particles.setColor(particleColor)
      particles.setSpeed(expression.particleSpeed)
      particles.setOpacity(0.32 + lip.aura * 0.58)
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
      const prevStyle = currentStyle
      const prevOutfit = currentOutfit
      const prevAccessories = [...params.accessories]

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
      caterpillar.smoke.setReducedMotion(reducedMotion)

      // Só a cor não reconstrói a malha; estilo/roupa/acessórios reconstroem.
      applyThemeChange(
        { style: prevStyle, outfit: prevOutfit, accessories: prevAccessories },
        { style: next.style, outfit: next.outfit, accessories: next.accessories },
        {
          rebuildCaterpillar: () => rebuildCaterpillar(),
          rebuildOutline: () => applyOutlines({ includeSmall: !smallOutlinesRemoved }),
          syncMaterialColors: () => syncMaterialColors(),
          outlineStrength
        }
      )
    },
    setOutlineStrength(strength: number): void {
      const next = clampOutlineStrength(strength)
      const wasEnabled = outlineStrength > 0
      const willBeEnabled = next > 0
      outlineStrength = next
      // Só recria contorno quando a presença muda ou a força muda; malha intacta.
      if (wasEnabled !== willBeEnabled || willBeEnabled)
        applyOutlines({ includeSmall: !smallOutlinesRemoved })
      else clearOutlines()
    },
    setLook(nextLook: AvatarLook | string): void {
      const next = resolveAvatarLook(nextLook)
      if (next === look) return
      // Sem recriar renderer/câmera/loop nem `holoMaterial`.
      applyLookToScene(next, {
        scene,
        renderer,
        lights: storybookLights,
        holoMaterial
      })
      look = next
      rebuildCaterpillar()
    },
    setVisible(visible: boolean): void {
      overlayVisible = visible
      syncRunning()
    },
    setReducedMotion(reduced: boolean): void {
      reducedMotion = reduced
      particles.setReducedMotion(reduced)
      caterpillar.smoke.setReducedMotion(reduced)
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
      // Contorno liberado antes da malha; idempotente.
      clearOutlines()
      root.remove(caterpillar.root)
      root.remove(particles.points)
      caterpillar.dispose()
      particles.dispose()
      roleMaterials.dispose()
      holoMaterial.dispose()
      darkMaterial.dispose()
      // Luzes do acabamento ilustrado (task 19): removidas e liberadas.
      scene.remove(storybookLights)
      ambientLight.dispose()
      directionalLight.dispose()
      // Rampa toon (task 19): liberada uma vez; idempotente.
      toonGradient.dispose()
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
