import { createHash } from 'crypto'
import type {
  CaptureKind,
  CaptureSource,
  PrivacyScreenConfig,
  RegionSelection,
  ScreenRect
} from '../../shared/screen'
import {
  CAPTURE_FRAME_TIMEOUT_MS,
  MAX_CAPTURE_BYTES,
  OVERLAY_HIDE_DELAY_MS,
  estimateImageTokens,
  isBlockedTarget
} from '../../shared/screen'
import type { VoiceState } from '../../shared/voice'
import type { ForegroundWindow } from '../overlay/foreground'
import {
  clampRectToImage,
  computeCropRect,
  computeRegionRectPx,
  selectDisplayForBounds,
  type CaptureDisplay,
  type PixelRect
} from './activeWindow'

/**
 * Controlador de captura (task 07, T3-T6 e T8).
 *
 * Ordem obrigatória de uma captura:
 * 1. política (`off` recusa; `ask` confirma antes de qualquer pixel);
 * 2. alvo (tela, região ou janela ativa) e blocklist (título + processo);
 * 3. limites (20/h, proativo 1/60 s só em `listening`, teto mensal);
 * 4. esconder o overlay, esperar 120 ms e pedir o frame ao renderer;
 * 5. validar tipo/tamanho (8 MB), recortar quando necessário;
 * 6. auditoria sem imagem/título em claro e indicador desligado no `finally`.
 *
 * O controlador não conhece Electron nem o SDK: tudo é injetado. Os testes
 * exercitam a ordem e as recusas sem tela real.
 */

export type ImageMime = 'image/jpeg' | 'image/png'

export interface CapturedImage {
  mime: ImageMime
  data: ArrayBuffer
  width: number
  height: number
}

export interface CaptureGrabRequest {
  requestId: string
  sourceId: string
  pixelWidth: number
  pixelHeight: number
  lossless: boolean
}

export interface CaptureConfirmRequest {
  kind: CaptureKind
  title: string
  processName?: string
  displayId: string
  reason: string
}

export interface CaptureAuditEvent {
  at: string
  mode: PrivacyScreenConfig['mode']
  kind: CaptureKind
  titleHash: string
  w: number
  h: number
  bytes: number
  sha256: string
}

export type CaptureFailureCode =
  | 'off'
  | 'blocked'
  | 'denied'
  | 'limit'
  | 'quota'
  | 'foreground'
  | 'bounds'
  | 'timeout'
  | 'too-large'
  | 'invalid'
  | 'grab'
  | 'cancelled'

export interface CaptureFailure {
  code: CaptureFailureCode
  message: string
}

export type CaptureResult =
  | {
      ok: true
      kind: CaptureKind
      mode: PrivacyScreenConfig['mode']
      displayId: string
      titleHash: string
      image: CapturedImage
      imageTokens: number
      imageTokensEstimated: true
      audit: CaptureAuditEvent
    }
  | { ok: false; error: CaptureFailure }

export interface CaptureRequest {
  kind: CaptureKind
  displayId?: string
  region?: RegionSelection
  question?: string
  requestId?: string
  lossless?: boolean
  proactive?: boolean
}

export interface CaptureLimitsLike {
  check: (input: {
    proactive: boolean
    proactiveEnabled?: boolean
    voiceState: VoiceState | null
    now: number
  }) => { ok: true } | { ok: false; message: string; code?: CaptureFailureCode }
  record: (info: { at: number; kind: CaptureKind; proactive?: boolean }) => void
}

export interface CaptureControllerDeps {
  getPrivacy: () => PrivacyScreenConfig
  getVoiceState?: () => VoiceState | null
  isOverlayVisible: () => boolean
  hideOverlay: () => void
  showOverlay: () => void
  sleep?: (ms: number) => Promise<void>
  listScreens: () => Promise<CaptureSource[]>
  getDisplays: () => CaptureDisplay[]
  getForeground?: () => Promise<ForegroundWindow | null>
  selectRegion?: () => Promise<RegionSelection | null>
  grab: (request: CaptureGrabRequest) => Promise<CapturedImage>
  crop?: (image: CapturedImage, rect: PixelRect) => Promise<CapturedImage> | CapturedImage
  confirm?: (request: CaptureConfirmRequest) => Promise<boolean>
  audit: (event: CaptureAuditEvent) => void
  pushIndicator?: (push: { active: boolean; kind?: CaptureKind }) => void
  limits?: CaptureLimitsLike
  now?: () => number
}

class CaptureTimeoutError extends Error {
  constructor() {
    super('tempo esgotado ao capturar a tela')
    this.name = 'CaptureTimeoutError'
  }
}

const failure = (
  code: CaptureFailureCode,
  message: string
): { ok: false; error: CaptureFailure } => ({
  ok: false,
  error: { code, message }
})

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function toBytes(data: ArrayBuffer): Uint8Array {
  return new Uint8Array(data)
}

function isAcceptableImage(image: CapturedImage | null | undefined): image is CapturedImage {
  if (!image || typeof image !== 'object') return false
  if (image.mime !== 'image/jpeg' && image.mime !== 'image/png') return false
  if (!(image.data instanceof ArrayBuffer)) return false
  return (
    Number.isFinite(image.width) &&
    Number.isFinite(image.height) &&
    image.width > 0 &&
    image.height > 0 &&
    image.data.byteLength > 0
  )
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new CaptureTimeoutError())
    }, ms)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function shortError(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 300)
  return String(err).slice(0, 300)
}

function hasScale(display: CaptureDisplay): boolean {
  return typeof display.scaleFactor === 'number' && display.scaleFactor > 0
}

export class CaptureController {
  private readonly deps: CaptureControllerDeps
  private readonly now: () => number

  constructor(deps: CaptureControllerDeps) {
    this.deps = deps
    this.now = deps.now ?? (() => Date.now())
  }

  async capture(request: CaptureRequest): Promise<CaptureResult> {
    let privacy: PrivacyScreenConfig
    try {
      privacy = this.deps.getPrivacy()
    } catch {
      return failure('off', 'Não foi possível ler a política de captura de tela.')
    }
    if (privacy.mode === 'off') {
      return failure(
        'off',
        'Captura de tela desligada. Ligue em Configurações > Privacidade (privacy.screen.mode).'
      )
    }
    if (
      request.kind !== 'screen' &&
      request.kind !== 'region' &&
      request.kind !== 'active-window'
    ) {
      return failure('invalid', 'Tipo de captura inválido.')
    }
    const proactive = request.proactive === true
    if (proactive && !privacy.proactive) {
      return failure(
        'limit',
        'Captura proativa desligada. Ative privacy.screen.proactive para permitir.'
      )
    }
    const voiceState = proactive ? (this.deps.getVoiceState?.() ?? null) : null
    if (proactive && voiceState !== 'listening') {
      return failure('limit', 'Captura proativa só acontece com a sessão de voz ouvindo.')
    }

    const target = await this.resolveTarget(request, privacy)
    if (!target.ok) return target
    const { title, processName, display, sourceId, region, titleForHash } = target

    const limits = this.deps.limits
    if (limits) {
      try {
        const decision = limits.check({
          proactive,
          proactiveEnabled: privacy.proactive,
          voiceState,
          now: this.now()
        })
        if (!decision.ok) return failure(decision.code ?? 'limit', decision.message)
      } catch (err) {
        return failure('limit', shortError(err))
      }
    }

    if (privacy.mode === 'ask') {
      if (!this.deps.confirm) {
        return failure('denied', 'Confirmação necessária para capturar a tela, mas indisponível.')
      }
      let accepted: boolean
      try {
        accepted = await this.deps.confirm({
          kind: request.kind,
          title,
          ...(processName ? { processName } : {}),
          displayId: display.id,
          reason: 'A imagem será enviada ao Gemini junto com a sua pergunta.'
        })
      } catch {
        accepted = false
      }
      if (!accepted) return failure('denied', 'Captura de tela não confirmada pelo usuário.')
    }

    const pixelWidth = Math.max(1, Math.round(display.bounds.width * (display.scaleFactor || 1)))
    const pixelHeight = Math.max(1, Math.round(display.bounds.height * (display.scaleFactor || 1)))
    const requestId = request.requestId ?? `capture-${this.now()}`
    const wasVisible = this.deps.isOverlayVisible()
    let hidden = false

    try {
      if (wasVisible) {
        this.deps.hideOverlay()
        hidden = true
        await (this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(
          OVERLAY_HIDE_DELAY_MS
        )
      }
      this.deps.pushIndicator?.({ active: true, kind: request.kind })

      let image: CapturedImage
      try {
        image = await withTimeout(
          this.deps.grab({
            requestId,
            sourceId,
            pixelWidth,
            pixelHeight,
            lossless: request.lossless === true || request.kind === 'region'
          }),
          CAPTURE_FRAME_TIMEOUT_MS
        )
      } catch (err) {
        if (err instanceof CaptureTimeoutError) {
          return failure('timeout', 'A captura de tela não respondeu em 4 segundos.')
        }
        return failure('grab', `Falha ao capturar a tela: ${shortError(err)}`)
      }

      if (!isAcceptableImage(image)) {
        return failure('invalid', 'A captura veio vazia ou num formato não suportado.')
      }
      if (image.data.byteLength > MAX_CAPTURE_BYTES) {
        return failure(
          'too-large',
          `A captura passou do limite de ${Math.round(MAX_CAPTURE_BYTES / 1024 / 1024)} MB. ` +
            'Selecione uma região menor ou use JPEG.'
        )
      }

      let finalImage = image
      let cropRect: PixelRect | null = null
      if (request.kind === 'active-window') {
        cropRect = computeCropRect(region as ScreenRect, display)
      } else if (request.kind === 'region') {
        cropRect = computeRegionRectPx((region as RegionSelection).rect, display)
      }
      if (cropRect) {
        const clamped = clampRectToImage(cropRect, image.width, image.height)
        if (!clamped) {
          return failure(
            'bounds',
            'A área selecionada ficou fora da captura. Tente novamente com uma janela ou região visível.'
          )
        }
        if (!this.deps.crop) {
          return failure('invalid', 'Recorte indisponível nesta instalação.')
        }
        try {
          finalImage = await this.deps.crop(image, clamped)
        } catch (err) {
          return failure('grab', `Falha ao recortar a captura: ${shortError(err)}`)
        }
        if (!isAcceptableImage(finalImage)) {
          return failure('invalid', 'O recorte da captura veio vazio.')
        }
        if (finalImage.data.byteLength > MAX_CAPTURE_BYTES) {
          return failure('too-large', 'O recorte passou do limite de 8 MB.')
        }
      }

      const bytes = toBytes(finalImage.data)
      const audit: CaptureAuditEvent = {
        at: new Date(this.now()).toISOString(),
        mode: privacy.mode,
        kind: request.kind,
        titleHash: hashText(titleForHash),
        w: finalImage.width,
        h: finalImage.height,
        bytes: bytes.byteLength,
        sha256: sha256Bytes(bytes)
      }
      try {
        this.deps.audit(audit)
      } catch {
        // Auditoria é best-effort: falha de log não impede a resposta.
      }
      try {
        limits?.record({ at: this.now(), kind: request.kind, proactive })
      } catch {
        // Limite é contabilizado após a captura; falha de registro não a desfaz.
      }

      return {
        ok: true,
        kind: request.kind,
        mode: privacy.mode,
        displayId: display.id,
        titleHash: audit.titleHash,
        image: finalImage,
        imageTokens: estimateImageTokens(finalImage.width, finalImage.height),
        imageTokensEstimated: true,
        audit
      }
    } finally {
      if (hidden) this.deps.showOverlay()
      this.deps.pushIndicator?.({ active: false })
    }
  }

  private async resolveTarget(
    request: CaptureRequest,
    privacy: PrivacyScreenConfig
  ): Promise<
    | {
        ok: true
        title: string
        processName?: string
        display: CaptureDisplay
        sourceId: string
        region?: ScreenRect | RegionSelection
        titleForHash: string
      }
    | { ok: false; error: CaptureFailure }
  > {
    const displays = this.deps.getDisplays()
    if (!Array.isArray(displays) || displays.length === 0) {
      return failure('invalid', 'Nenhum monitor disponível para captura.')
    }

    if (request.kind === 'active-window') {
      if (!this.deps.getForeground) {
        return failure('foreground', 'Não foi possível identificar a janela ativa.')
      }
      let foreground: ForegroundWindow | null
      try {
        foreground = await this.deps.getForeground()
      } catch {
        foreground = null
      }
      if (!foreground) {
        return failure('foreground', 'Não foi possível identificar a janela ativa.')
      }
      const display = selectDisplayForBounds(displays, foreground.bounds)
      if (!display) {
        return failure('bounds', 'A janela ativa está fora dos monitores conhecidos.')
      }
      if (!hasScale(display)) {
        return failure('bounds', 'O monitor da janela ativa não informou a escala.')
      }
      const blocked = isBlockedTarget(foreground.title, foreground.processName, privacy.blocklist)
      if (blocked) {
        return failure(
          'blocked',
          `Captura recusada: "${blocked}" está na lista de janelas sensíveis. ` +
            'Edite privacy.screen.blocklist nas configurações para permitir.'
        )
      }
      const source = await this.findScreenSource(display.id)
      if (!source.ok) return source
      return {
        ok: true,
        title: foreground.title,
        processName: foreground.processName,
        display,
        sourceId: source.sourceId,
        region: foreground.bounds,
        titleForHash: foreground.title
      }
    }

    if (request.kind === 'region') {
      let selection: RegionSelection | null = request.region ?? null
      if (!selection) {
        if (!this.deps.selectRegion) {
          return failure('invalid', 'Seleção de região indisponível nesta instalação.')
        }
        try {
          selection = await this.deps.selectRegion()
        } catch (err) {
          return failure('grab', `Falha ao selecionar a região: ${shortError(err)}`)
        }
      }
      if (!selection) {
        return failure('cancelled', 'Seleção de região cancelada.')
      }
      const display = displays.find((entry) => entry.id === selection.displayId)
      if (!display) {
        return failure('invalid', 'O monitor da região selecionada não existe mais.')
      }
      if (!hasScale(display)) {
        return failure('bounds', 'O monitor da região não informou a escala.')
      }
      const source = await this.findScreenSource(display.id)
      if (!source.ok) return source
      return {
        ok: true,
        title: 'região selecionada',
        display,
        sourceId: source.sourceId,
        region: selection,
        titleForHash: `region:${display.id}`
      }
    }

    const display = request.displayId
      ? displays.find((entry) => entry.id === request.displayId)
      : displays[0]
    if (!display) {
      return failure('invalid', 'Monitor escolhido não encontrado.')
    }
    if (!hasScale(display)) {
      return failure('bounds', 'O monitor escolhido não informou a escala.')
    }
    const source = await this.findScreenSource(display.id)
    if (!source.ok) return source
    return {
      ok: true,
      title: source.name,
      display,
      sourceId: source.sourceId,
      titleForHash: source.name
    }
  }

  private async findScreenSource(
    displayId: string
  ): Promise<{ ok: true; sourceId: string; name: string } | { ok: false; error: CaptureFailure }> {
    let screens: CaptureSource[]
    try {
      screens = await this.deps.listScreens()
    } catch (err) {
      return failure('grab', `Falha ao listar as telas: ${shortError(err)}`)
    }
    const match =
      screens.find((screen) => screen.displayId === displayId) ??
      (screens.length === 1 ? screens[0] : undefined)
    if (!match) {
      return failure('invalid', 'Nenhuma fonte de captura encontrada para o monitor.')
    }
    return { ok: true, sourceId: match.id, name: match.name }
  }
}

export function createCaptureController(deps: CaptureControllerDeps): CaptureController {
  return new CaptureController(deps)
}
