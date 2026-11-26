import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionsConfig } from '../shared/config'
import {
  MICROPHONE_DENIED_MESSAGE,
  isMicrophoneGranted,
  setMicrophoneConsent,
  withMicrophoneConsent
} from './voice/consent'
import {
  createMediaPermissionHandlers,
  registerMediaPermissions,
  type PermissionCheckHandler,
  type PermissionRequestHandler,
  type PermissionSessionLike
} from './permissions'

/**
 * Gate de microfone: o Chromium só libera `media` para o overlay e só com
 * consentimento persistido. Estes testes exercitam os handlers diretamente,
 * sem Electron e sem `getUserMedia`.
 */

function createSession() {
  const state: {
    request: PermissionRequestHandler | null
    check: PermissionCheckHandler | null
  } = { request: null, check: null }
  const session: PermissionSessionLike = {
    setPermissionRequestHandler: (handler) => {
      state.request = handler
    },
    setPermissionCheckHandler: (handler) => {
      state.check = handler
    }
  }
  return { session, state }
}

describe('permissões de microfone', () => {
  let overlayContents: object
  let otherContents: object

  beforeEach(() => {
    overlayContents = {}
    otherContents = {}
  })

  it('media só é permitido para o webContents do overlay', () => {
    const { session, state } = createSession()
    registerMediaPermissions({
      session,
      isOverlayContents: (contents) => contents === overlayContents,
      hasConsent: () => true
    })

    const allowed = vi.fn()
    state.request?.(overlayContents, 'media', allowed)
    expect(allowed).toHaveBeenCalledWith(true)

    allowed.mockClear()
    state.request?.(otherContents, 'media', allowed)
    expect(allowed).toHaveBeenCalledWith(false)

    allowed.mockClear()
    state.request?.(overlayContents, 'notifications', allowed)
    expect(allowed).toHaveBeenCalledWith(false)

    expect(state.check?.(overlayContents, 'media', '')).toBe(true)
    expect(state.check?.(otherContents, 'media', '')).toBe(false)
    expect(state.check?.(overlayContents, 'geolocation', '')).toBe(false)
  })

  it('consentimento negado bloqueia getUserMedia mesmo no overlay', () => {
    const { session, state } = createSession()
    let consent = false
    registerMediaPermissions({
      session,
      isOverlayContents: (contents) => contents === overlayContents,
      hasConsent: () => consent
    })

    const handlers = createMediaPermissionHandlers({
      session,
      isOverlayContents: (contents) => contents === overlayContents,
      hasConsent: () => consent
    })
    const allowed = vi.fn()
    handlers.request(overlayContents, 'media', allowed)
    expect(allowed).toHaveBeenCalledWith(false)

    consent = true
    const allowedAfter = vi.fn()
    state.request?.(overlayContents, 'media', allowedAfter)
    expect(allowedAfter).toHaveBeenCalledWith(true)
    expect(MICROPHONE_DENIED_MESSAGE).toContain('texto')
  })

  it('consentimento é persistido preservando as demais permissões', () => {
    const data: PermissionsConfig = {
      microphone: false,
      screenVision: true,
      computerControl: false,
      fileAccess: true
    }
    const store = {
      read: () => ({ ...data }),
      write: (next: PermissionsConfig) => {
        Object.assign(data, next)
        return { success: true }
      }
    }

    expect(isMicrophoneGranted(store)).toBe(false)
    expect(setMicrophoneConsent(store, true)).toEqual({ ok: true })
    expect(data).toEqual(withMicrophoneConsent(data, true))
    expect(data.screenVision).toBe(true)
    expect(data.fileAccess).toBe(true)
    expect(isMicrophoneGranted(store)).toBe(true)

    expect(setMicrophoneConsent(store, false)).toEqual({ ok: true })
    expect(isMicrophoneGranted(store)).toBe(false)

    const failing = {
      read: () => data,
      write: () => ({ success: false, error: 'disco cheio' })
    }
    expect(setMicrophoneConsent(failing, true)).toEqual({ ok: false, error: 'disco cheio' })
  })
})
