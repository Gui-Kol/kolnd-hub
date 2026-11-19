import { describe, expect, it } from 'vitest'
import {
  ACTION_MESSAGE_MAX,
  ACTION_RATE_LIMIT,
  ACTION_TEXT_MAX,
  buildApprovePermission,
  buildDenyPermission,
  buildSendMessage,
  createActionLimiter,
  normalizeOfficeAction,
  parseActionMode,
  parseOfficeAction,
  pluginActionResult
} from './actions'

const SES = 'ses_e11144d50ffe000000000001'
const REQUEST = 'per_abc123'

describe('normalizeOfficeAction', () => {
  it('aceita permission.reply com e sem mensagem', () => {
    expect(
      normalizeOfficeAction({
        action: 'permission.reply',
        sessionID: SES,
        requestID: REQUEST,
        decision: 'once'
      })
    ).toEqual({
      action: 'permission.reply',
      sessionID: SES,
      requestID: REQUEST,
      decision: 'once'
    })

    expect(
      normalizeOfficeAction({
        action: 'permission.reply',
        sessionID: SES,
        requestID: REQUEST,
        decision: 'reject',
        message: '  não quero  '
      })
    ).toMatchObject({ decision: 'reject', message: 'não quero' })
  })

  it('recusa sessão fora do formato ses_, decisão desconhecida e chave extra', () => {
    const base = {
      action: 'permission.reply',
      sessionID: SES,
      requestID: REQUEST,
      decision: 'once'
    }
    expect(normalizeOfficeAction({ ...base, sessionID: 'outra-sessao' })).toBeNull()
    expect(normalizeOfficeAction({ ...base, sessionID: 'ses_' })).toBeNull()
    expect(normalizeOfficeAction({ ...base, decision: 'talvez' })).toBeNull()
    expect(normalizeOfficeAction({ ...base, extra: true })).toBeNull()
    expect(normalizeOfficeAction({ ...base, requestID: '' })).toBeNull()
    expect(
      normalizeOfficeAction({ ...base, message: 'x'.repeat(ACTION_MESSAGE_MAX + 1) })
    ).toBeNull()
    expect(normalizeOfficeAction(null)).toBeNull()
  })

  it('aceita session.prompt e recusa texto gigante ou com caractere de controle', () => {
    expect(
      normalizeOfficeAction({ action: 'session.prompt', sessionID: SES, text: '  revisar  ' })
    ).toEqual({ action: 'session.prompt', sessionID: SES, text: 'revisar' })

    expect(
      normalizeOfficeAction({
        action: 'session.prompt',
        sessionID: SES,
        text: 'oi',
        delivery: 'queue'
      })
    ).toMatchObject({ delivery: 'queue' })

    expect(
      normalizeOfficeAction({
        action: 'session.prompt',
        sessionID: SES,
        text: 'x'.repeat(ACTION_TEXT_MAX + 1)
      })
    ).toBeNull()
    expect(
      normalizeOfficeAction({ action: 'session.prompt', sessionID: SES, text: 'a\u0000b' })
    ).toBeNull()
    expect(
      normalizeOfficeAction({
        action: 'session.prompt',
        sessionID: SES,
        text: 'oi',
        delivery: 'agora'
      })
    ).toBeNull()
  })
})

describe('parseOfficeAction (comando da ponte)', () => {
  it('exige id válido e devolve o payload completo', () => {
    const command = parseOfficeAction({
      id: 'act_1a2b3c',
      action: 'permission.reply',
      sessionID: SES,
      requestID: REQUEST,
      decision: 'always'
    })
    expect(command).toEqual({
      id: 'act_1a2b3c',
      action: 'permission.reply',
      sessionID: SES,
      requestID: REQUEST,
      decision: 'always'
    })

    expect(parseOfficeAction({ action: 'session.prompt', sessionID: SES, text: 'oi' })).toBeNull()
    expect(
      parseOfficeAction({
        id: 'id com espaço',
        action: 'session.prompt',
        sessionID: SES,
        text: 'oi'
      })
    ).toBeNull()
  })
})

describe('builders do IPC', () => {
  it('aprovar só aceita once/always; negar sempre vira reject', () => {
    expect(
      buildApprovePermission({ sessionID: SES, requestID: REQUEST, decision: 'once' })
    ).toEqual({
      ok: true,
      action: { action: 'permission.reply', sessionID: SES, requestID: REQUEST, decision: 'once' }
    })
    expect(
      buildApprovePermission({ sessionID: SES, requestID: REQUEST, decision: 'reject' })
    ).toEqual({ ok: false, reason: 'invalido' })

    expect(buildDenyPermission({ sessionID: SES, requestID: REQUEST, message: 'fora' })).toEqual({
      ok: true,
      action: {
        action: 'permission.reply',
        sessionID: SES,
        requestID: REQUEST,
        decision: 'reject',
        message: 'fora'
      }
    })
  })

  it('mensagem valida sessionID, whitelist e limite de texto', () => {
    expect(buildSendMessage({ sessionID: SES, text: '  olá  ' })).toEqual({
      ok: true,
      action: { action: 'session.prompt', sessionID: SES, text: 'olá' }
    })
    expect(buildSendMessage({ sessionID: 'x', text: 'oi' })).toEqual({
      ok: false,
      reason: 'invalido'
    })
    expect(buildSendMessage({ sessionID: SES, text: 'x'.repeat(ACTION_TEXT_MAX + 1) })).toEqual({
      ok: false,
      reason: 'texto-longo'
    })
    expect(buildSendMessage({ sessionID: SES, text: 'oi', extra: 1 })).toEqual({
      ok: false,
      reason: 'invalido'
    })
    expect(buildSendMessage({ sessionID: SES, text: '   ' })).toEqual({
      ok: false,
      reason: 'invalido'
    })
  })

  it('modo aceita apenas { enabled: boolean }', () => {
    expect(parseActionMode({ enabled: true })).toEqual({ enabled: true })
    expect(parseActionMode({ enabled: 'sim' })).toBeNull()
    expect(parseActionMode({ enabled: true, persistir: true })).toBeNull()
    expect(parseActionMode(null)).toBeNull()
  })
})

describe('createActionLimiter', () => {
  it('limita a 10 ações por sessão na janela de 1 minuto', () => {
    let clock = 1000
    const limiter = createActionLimiter({ now: () => clock })

    for (let index = 0; index < ACTION_RATE_LIMIT; index += 1) {
      expect(limiter.take(SES)).toBe(true)
    }
    expect(limiter.take(SES)).toBe(false)
    // Outra sessão tem a própria cota.
    expect(limiter.take('ses_outra000000000000000000')).toBe(true)
    // Passado o minuto, a cota volta.
    clock += 60_001
    expect(limiter.take(SES)).toBe(true)
  })
})

describe('pluginActionResult', () => {
  it('devolve ok curto ou erro saneado', () => {
    expect(pluginActionResult(true)).toEqual({ ok: true })
    expect(pluginActionResult(false, '  falhou\nno opencode  ')).toEqual({
      ok: false,
      error: 'falhou no opencode'
    })
    expect(pluginActionResult(false)).toEqual({ ok: false, error: 'a ação falhou' })
    expect(pluginActionResult(false, 'x'.repeat(300)).ok).toBe(false)
    const long = pluginActionResult(false, 'x'.repeat(300))
    expect(long.ok === false && long.error.length <= 200).toBe(true)
  })
})
