import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type {
  CaptureAskRequest,
  CaptureCancelRequest,
  CaptureRegionResult,
  CaptureSourcesResult,
  CaptureStatusResult,
  IpcError,
  SimpleResult
} from '../../shared/ipc'
import { isCaptureKind, normalizeRegionSelection, type CaptureSource } from '../../shared/screen'
import { logger } from '../logger'
import type { CaptureRuntime } from '../capture/instance'
import { listSources } from '../capture/sources'
import { checkPayloadLimits, isTrustedSender, sanitizeIpcError } from '../security/ipcGuard'

/**
 * Canais IPC da visão de tela (task 07).
 *
 * O main valida todo payload `unknown`; falha sempre vira `{ ok:false, error }`.
 * `capture:ask` responde na hora e o streaming segue em `chat:*`, como no chat
 * de texto. Em `mode:'off'` nem `capture:ask` nem `capture:region` abrem
 * captura; `capture:status` continua respondendo para a UI/smoke.
 */

const MAX_REQUEST_ID = 128
const MAX_QUESTION_CHARS = 4_000

function failure(error: string): IpcError {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function compareScreens(a: CaptureSource, b: CaptureSource): number {
  const left = Number(a.displayId)
  const right = Number(b.displayId)
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right
  return (a.displayId ?? '').localeCompare(b.displayId ?? '')
}

function modeOffMessage(): string {
  return (
    'Captura de tela desligada. Ative em Configurações > Privacidade ' +
    '(privacy.screen.mode = ask ou on).'
  )
}

function parseAsk(payload: unknown): CaptureAskRequest | string {
  if (!isRecord(payload)) return `Payload inválido para ${IPC.captureAsk}.`
  const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : ''
  if (!requestId || requestId.length > MAX_REQUEST_ID) return 'requestId inválido.'
  const question = typeof payload.question === 'string' ? payload.question.trim() : ''
  if (!question || question.length > MAX_QUESTION_CHARS) return 'Pergunta inválida.'
  if (!isCaptureKind(payload.kind)) return 'Tipo de captura inválido.'
  if (payload.displayId !== undefined && typeof payload.displayId !== 'string') {
    return 'displayId inválido.'
  }
  if (typeof payload.displayId === 'string' && payload.displayId.length > 64) {
    return 'displayId longo demais.'
  }
  let region
  if (payload.region !== undefined) {
    region = normalizeRegionSelection(payload.region)
    if (!region) return 'Região inválida.'
  }
  if (payload.proactive !== undefined && typeof payload.proactive !== 'boolean') {
    return 'proactive inválido.'
  }
  const request: CaptureAskRequest = {
    requestId,
    kind: payload.kind,
    question
  }
  if (typeof payload.displayId === 'string' && payload.displayId.trim()) {
    request.displayId = payload.displayId.trim()
  }
  if (region) request.region = region
  if (payload.proactive === true) request.proactive = true
  return request
}

function parseCancel(payload: unknown): CaptureCancelRequest | string {
  if (payload === undefined || payload === null) return {}
  if (!isRecord(payload)) return `Payload inválido para ${IPC.captureCancel}.`
  const request: CaptureCancelRequest = {}
  if (payload.requestId !== undefined) {
    if (
      typeof payload.requestId !== 'string' ||
      payload.requestId.length === 0 ||
      payload.requestId.length > MAX_REQUEST_ID
    ) {
      return 'requestId inválido.'
    }
    request.requestId = payload.requestId
  }
  if (payload.kind !== undefined) {
    if (payload.kind !== 'region' && payload.kind !== 'ask') return 'kind inválido.'
    request.kind = payload.kind
  }
  return request
}

export function registerCaptureIpc(runtime: CaptureRuntime): void {
  ipcMain.handle(IPC.captureSources, async (): Promise<CaptureSourcesResult> => {
    try {
      const sources = await listSources()
      return {
        ok: true,
        screens: sources.filter((source) => source.kind === 'screen').sort(compareScreens),
        windows: sources.filter((source) => source.kind === 'window')
      }
    } catch (err) {
      const message = sanitizeIpcError(err, 'falha ao listar fontes')
      logger.warn('capture', 'falha ao listar fontes', { message })
      return failure(message)
    }
  })

  ipcMain.handle(IPC.captureAsk, (event, payload: unknown): SimpleResult => {
    if (!isTrustedSender(event)) return failure('Remetente não autorizado.')
    const limits = checkPayloadLimits(payload)
    if (!limits.ok) return failure(limits.message)
    const parsed = parseAsk(payload)
    if (typeof parsed === 'string') return failure(parsed)
    if (runtime.status().mode === 'off') return failure(modeOffMessage())
    runtime.ask(parsed)
    return { ok: true }
  })

  ipcMain.handle(IPC.captureRegion, async (event): Promise<CaptureRegionResult> => {
    if (!isTrustedSender(event)) return failure('Remetente não autorizado.')
    if (runtime.status().mode === 'off') return failure(modeOffMessage())
    try {
      const selection = await runtime.selector.select()
      return { ok: true, canceled: selection === null, selection }
    } catch (err) {
      const message = sanitizeIpcError(err, 'falha na seleção')
      logger.warn('capture', 'falha na seleção de região', { message })
      return failure(message)
    }
  })

  ipcMain.handle(IPC.captureStatus, (): CaptureStatusResult => runtime.statusResult())

  ipcMain.handle(IPC.captureResult, (event, payload: unknown): SimpleResult => {
    if (!isTrustedSender(event)) return failure('Remetente não autorizado.')
    const limits = checkPayloadLimits(payload)
    if (!limits.ok) return failure(limits.message)
    const result = runtime.handleFrameResult(payload)
    return result.ok ? { ok: true } : failure(result.error ?? 'captura falhou')
  })

  ipcMain.handle(IPC.captureCancel, (event, payload: unknown): SimpleResult => {
    if (!isTrustedSender(event)) return failure('Remetente não autorizado.')
    const parsed = parseCancel(payload)
    if (typeof parsed === 'string') return failure(parsed)
    runtime.cancel(parsed)
    return { ok: true }
  })

  // Canal interno da janela de região. Só aceita conteúdo criado por ela.
  ipcMain.on(IPC.captureRegionResult, (event, payload: unknown) => {
    if (!isTrustedSender(event)) {
      logger.warn('capture', 'resultado de região ignorado (remetente não autorizado)')
      return
    }
    const contentsId = event.sender.id
    if (!runtime.isRegionContents(contentsId)) {
      logger.warn('capture', 'resultado de região ignorado (remetente desconhecido)')
      return
    }
    const accepted = runtime.submitRegion(contentsId, payload)
    if (!accepted) logger.warn('capture', 'seleção de região inválida ignorada')
  })
}
