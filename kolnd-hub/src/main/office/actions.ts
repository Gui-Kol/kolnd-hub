import { truncateLabel } from '../../shared/office'

/**
 * Contrato das AÇÕES do Escritório (Fase 3 — T13/T14).
 *
 * É puro de propósito: o IPC, a ponte e o plugin compartilham as mesmas regras
 * sem importar `electron`. Tudo que entra é `unknown` e só passa se estiver
 * exatamente no formato abaixo (AGENTS.md: IPC valida tipo, tamanho, formato e
 * whitelist — o renderer pode estar comprometido).
 *
 * Privacidade (D10): o texto da mensagem nunca é logado nem guardado. Este
 * módulo só o valida; quem audita usa `action`/`sessionID`/desfecho.
 */

/** Limite do prompt enviado ao agente (T14). */
export const ACTION_TEXT_MAX = 2000

/** Motivo de negação/observação de permissão — curto e opcional. */
export const ACTION_MESSAGE_MAX = 500

/** Janela do rate limit por sessão (10 ações/min). */
export const ACTION_RATE_LIMIT = 10
export const ACTION_RATE_WINDOW_MS = 60_000

/** Teto de sessões distintas observadas pelo rate limit em memória. */
const RATE_MAX_SESSIONS = 200

const SESSION_ID = /^ses_[A-Za-z0-9]{1,116}$/
const ACTION_ID = /^[A-Za-z0-9_-]{1,64}$/
/**
 * Controles C0 (exceto tab/LF/CR) e DEL. Newlines são legítimos no prompt;
 * NUL, ESC e afins não têm o que fazer numa mensagem de chat.
 */
// eslint-disable-next-line no-control-regex -- validar controles é o objetivo
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

export type OfficePermissionDecision = 'once' | 'always' | 'reject'
export type OfficePromptDelivery = 'steer' | 'queue'

/** Ação já validada, sem id (o id nasce na fila da ponte). */
export type OfficeAction =
  | {
      action: 'permission.reply'
      sessionID: string
      requestID: string
      decision: OfficePermissionDecision
      message?: string
    }
  | {
      action: 'session.prompt'
      sessionID: string
      text: string
      delivery?: OfficePromptDelivery
    }

/** Ação entregue ao plugin: o payload + o id que volta no resultado. */
export type OfficeActionCommand = OfficeAction & { id: string }

export type OfficeActionRefusalReason =
  'invalido' | 'texto-longo' | 'somente-leitura' | 'limite' | 'fila-cheia'

export type OfficeActionEnqueueResult =
  { ok: true; id: string } | { ok: false; reason: OfficeActionRefusalReason }

/** Desfecho que a ponte devolve ao renderer (`office:action-result`). */
export interface OfficeActionOutcome {
  id: string
  ok: boolean
  error?: string
}

/** O que a UI pode pedir. */
export interface OfficeApprovePermissionInput {
  sessionID: string
  requestID: string
  decision: Exclude<OfficePermissionDecision, 'reject'>
  message?: string
}

export interface OfficeDenyPermissionInput {
  sessionID: string
  requestID: string
  message?: string
}

export interface OfficeSendMessageInput {
  sessionID: string
  text: string
}

/** Modo de ações: ligado só enquanto a UI pedir (em memória, por execução). */
export interface OfficeActionModeInput {
  enabled: boolean
}

/** Resultado da validação de um pedido da UI. */
export type OfficeActionDecision =
  { ok: true; action: OfficeAction } | { ok: false; reason: 'invalido' | 'texto-longo' }

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function stringID(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null
}

export function isValidSessionID(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value)
}

export function isValidActionID(value: unknown): value is string {
  return typeof value === 'string' && ACTION_ID.test(value)
}

/**
 * Mensagem opcional: `undefined` quando ausente/vazia, `false` quando inválida.
 * Nunca "conserta" o conteúdo — o que o usuário escreveu é o que vai (trim só
 * nas bordas).
 */
function optionalMessage(value: unknown): string | undefined | false {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return false
  const flat = value.trim()
  if (!flat) return undefined
  if (flat.length > ACTION_MESSAGE_MAX || CONTROL_CHARS.test(flat)) return false
  return flat
}

function promptText(value: unknown): string | null | 'long' {
  if (typeof value !== 'string') return null
  const flat = value.trim()
  if (!flat || CONTROL_CHARS.test(flat)) return null
  if (flat.length > ACTION_TEXT_MAX) return 'long'
  return flat
}

/**
 * Valida o corpo de uma ação vindo da ponte (sem id). Devolve `null` para
 * qualquer chave/tipo/valor fora do contrato.
 */
export function normalizeOfficeAction(input: unknown): OfficeAction | null {
  const value = record(input)
  if (!value || typeof value.action !== 'string') return null
  const sessionID = isValidSessionID(value.sessionID) ? value.sessionID : null
  if (!sessionID) return null

  if (value.action === 'permission.reply') {
    if (!onlyKeys(value, ['action', 'sessionID', 'requestID', 'decision', 'message'])) return null
    const requestID = stringID(value.requestID, ACTION_ID)
    const decision = value.decision
    if (!requestID) return null
    if (decision !== 'once' && decision !== 'always' && decision !== 'reject') return null
    const message = optionalMessage(value.message)
    if (message === false) return null
    return {
      action: 'permission.reply',
      sessionID,
      requestID,
      decision,
      ...(message ? { message } : {})
    }
  }

  if (value.action === 'session.prompt') {
    if (!onlyKeys(value, ['action', 'sessionID', 'text', 'delivery'])) return null
    const text = promptText(value.text)
    if (!text || text === 'long') return null
    const delivery = value.delivery
    if (delivery !== undefined && delivery !== 'steer' && delivery !== 'queue') return null
    return {
      action: 'session.prompt',
      sessionID,
      text,
      ...(delivery ? { delivery } : {})
    }
  }

  return null
}

/** Valida o comando completo que trafega na ponte: payload + `id`. */
export function parseOfficeAction(input: unknown): OfficeActionCommand | null {
  const value = record(input)
  if (!value || !isValidActionID(value.id)) return null
  const id = value.id
  const { id: _ignored, ...rest } = value
  const action = normalizeOfficeAction(rest)
  return action ? { ...action, id } : null
}

/** Pedido de aprovação vindo do IPC (sem `action`; decisão nunca é `reject`). */
export function buildApprovePermission(input: unknown): OfficeActionDecision {
  const value = record(input)
  if (!value || !onlyKeys(value, ['sessionID', 'requestID', 'decision', 'message'])) {
    return { ok: false, reason: 'invalido' }
  }
  if (!isValidSessionID(value.sessionID)) return { ok: false, reason: 'invalido' }
  const requestID = stringID(value.requestID, ACTION_ID)
  if (!requestID) return { ok: false, reason: 'invalido' }
  if (value.decision !== 'once' && value.decision !== 'always') {
    return { ok: false, reason: 'invalido' }
  }
  const message = optionalMessage(value.message)
  if (message === false) return { ok: false, reason: 'invalido' }
  return {
    ok: true,
    action: {
      action: 'permission.reply',
      sessionID: value.sessionID,
      requestID,
      decision: value.decision,
      ...(message ? { message } : {})
    }
  }
}

/** Negar é sempre `reject` (o `message` é o motivo opcional). */
export function buildDenyPermission(input: unknown): OfficeActionDecision {
  const value = record(input)
  if (!value || !onlyKeys(value, ['sessionID', 'requestID', 'message'])) {
    return { ok: false, reason: 'invalido' }
  }
  if (!isValidSessionID(value.sessionID)) return { ok: false, reason: 'invalido' }
  const requestID = stringID(value.requestID, ACTION_ID)
  if (!requestID) return { ok: false, reason: 'invalido' }
  const message = optionalMessage(value.message)
  if (message === false) return { ok: false, reason: 'invalido' }
  return {
    ok: true,
    action: {
      action: 'permission.reply',
      sessionID: value.sessionID,
      requestID,
      decision: 'reject',
      ...(message ? { message } : {})
    }
  }
}

/** Mensagem para o agente: texto obrigatório, ≤ 2000 e sem controles. */
export function buildSendMessage(input: unknown): OfficeActionDecision {
  const value = record(input)
  if (!value || !onlyKeys(value, ['sessionID', 'text'])) {
    return { ok: false, reason: 'invalido' }
  }
  if (!isValidSessionID(value.sessionID)) return { ok: false, reason: 'invalido' }
  const text = promptText(value.text)
  if (text === 'long') return { ok: false, reason: 'texto-longo' }
  if (!text) return { ok: false, reason: 'invalido' }
  return { ok: true, action: { action: 'session.prompt', sessionID: value.sessionID, text } }
}

/** Liga/desliga o modo de ações; exige exatamente `{ enabled: boolean }`. */
export function parseActionMode(input: unknown): OfficeActionModeInput | null {
  const value = record(input)
  if (!value || !onlyKeys(value, ['enabled'])) return null
  return typeof value.enabled === 'boolean' ? { enabled: value.enabled } : null
}

/** Sanitiza o resultado devolvido pelo plugin (constante dele, nunca conteúdo). */
export function pluginActionResult(
  ok: boolean,
  error?: unknown
): { ok: true } | { ok: false; error: string } {
  if (ok) return { ok: true }
  const text = truncateLabel(String(error ?? ''), 200) || 'a ação falhou'
  return { ok: false, error: text.replace(CONTROL_CHARS, ' ') }
}

export interface OfficeActionLimiter {
  /** Consome uma ação da sessão; `false` quando passou de 10/min. */
  take(sessionID: string): boolean
  reset(): void
}

/** Rate limit em memória por sessão — morre com a execução, como o modo. */
export function createActionLimiter(
  options: { now?: () => number; limit?: number; windowMs?: number } = {}
): OfficeActionLimiter {
  const now = options.now ?? Date.now
  const limit = options.limit ?? ACTION_RATE_LIMIT
  const windowMs = options.windowMs ?? ACTION_RATE_WINDOW_MS
  const hits = new Map<string, number[]>()

  return {
    take(sessionID) {
      const at = now()
      const recent = (hits.get(sessionID) ?? []).filter((stamp) => at - stamp < windowMs)
      if (recent.length >= limit) {
        hits.set(sessionID, recent)
        return false
      }
      recent.push(at)
      hits.delete(sessionID)
      hits.set(sessionID, recent)
      while (hits.size > RATE_MAX_SESSIONS) {
        const oldest = hits.keys().next()
        if (oldest.done) break
        hits.delete(oldest.value)
      }
      return true
    },

    reset() {
      hits.clear()
    }
  }
}
