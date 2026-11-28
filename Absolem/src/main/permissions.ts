/**
 * Permissões de mídia do Chromium (task 06, gate de microfone).
 *
 * Regras fechadas:
 * - só `media` é liberado; qualquer outra permissão é negada;
 * - `media` só para o `webContents` da janela do overlay;
 * - `media` só quando `permissions.microphone === true`.
 *
 * O módulo não importa `electron`: o `session` real é injetado pela composição
 * de produção (`voice/instance.ts`), o que mantém o teste em Node puro.
 */

export interface PermissionDetailsLike {
  mediaTypes?: string[]
  requestingUrl?: string
}

export type PermissionRequestHandler = (
  webContents: unknown,
  permission: string,
  callback: (allowed: boolean) => void,
  details?: PermissionDetailsLike
) => void

export type PermissionCheckHandler = (
  webContents: unknown,
  permission: string,
  requestingOrigin: string,
  details?: PermissionDetailsLike
) => boolean

export interface PermissionSessionLike {
  setPermissionRequestHandler: (handler: PermissionRequestHandler | null) => void
  setPermissionCheckHandler: (handler: PermissionCheckHandler | null) => void
}

export interface MediaPermissionOptions {
  session: PermissionSessionLike
  /** `true` somente para o `webContents` vivo da janela do overlay. */
  isOverlayContents: (contents: unknown) => boolean
  /** Lido a cada pedido: revogar o consentimento vale imediatamente. */
  hasConsent: () => boolean
}

function allowsMedia(
  options: MediaPermissionOptions,
  contents: unknown,
  permission: string
): boolean {
  return permission === 'media' && options.isOverlayContents(contents) && options.hasConsent()
}

export function createMediaPermissionHandlers(options: MediaPermissionOptions): {
  request: PermissionRequestHandler
  check: PermissionCheckHandler
} {
  return {
    request: (_contents, permission, callback) => {
      callback(allowsMedia(options, _contents, permission))
    },
    check: (contents, permission) => allowsMedia(options, contents, permission)
  }
}

/**
 * Instala os dois handlers e devolve um `cleanup` idempotente (teste/recarga).
 */
export function registerMediaPermissions(options: MediaPermissionOptions): () => void {
  const handlers = createMediaPermissionHandlers(options)
  options.session.setPermissionRequestHandler(handlers.request)
  options.session.setPermissionCheckHandler(handlers.check)
  let cleaned = false
  return () => {
    if (cleaned) return
    cleaned = true
    options.session.setPermissionRequestHandler(null)
    options.session.setPermissionCheckHandler(null)
  }
}
