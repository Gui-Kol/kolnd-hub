// Guardas do `<webview>` da página Chat (Go Live).
//
// O site é de terceiros: roda na própria partição (`persist:golive`), com
// preload removido e Node desligado, e só a origem `golive.nemtudo.me` recebe
// permissões de mídia/tela. Navegação para fora do site vai para o navegador
// do sistema; esquemas desconhecidos são bloqueados. Nada disso expõe
// `window.api` ao guest — ele é outro WebContents, sem preload do Hub.
import {
  desktopCapturer,
  session,
  shell,
  type BrowserWindow,
  type Event as ElectronEvent
} from 'electron'
import { CHAT_PARTITION, classifyChatNavigation, isChatUrl } from '../shared/chat'
import { isAllowedExternalUrl } from './ipc/shell'
import { logger } from './logger'

/** Permissões que o site realmente usa (salas de voz e compartilhar tela). */
const ALLOWED_PERMISSIONS = new Set<string>([
  'media',
  'display-capture',
  'fullscreen',
  'clipboard-sanitized-write'
])

let chatSessionConfigured = false

/** `true` quando a origem requisitante é exatamente o Go Live (https). */
function isChatOrigin(raw: string | undefined | null): boolean {
  return typeof raw === 'string' && isChatUrl(raw)
}

/** Concede só para a origem do site; qualquer outra origem é negada e logada. */
function isPermissionAllowed(permission: string, requestingOrigin: string | undefined): boolean {
  return ALLOWED_PERMISSIONS.has(permission) && isChatOrigin(requestingOrigin)
}

/**
 * Configura a sessão da partição do Chat: permissões restritas à origem do
 * site, compartilhamento de tela pela tela primária e downloads cancelados.
 * Idempotente — o bootstrap chama uma vez, mas chamadas repetidas não
 * re-registram handlers.
 */
export function configureChatSession(): void {
  if (chatSessionConfigured) return
  chatSessionConfigured = true

  const chatSession = session.fromPartition(CHAT_PARTITION)

  chatSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const origin = details.securityOrigin ?? details.requestingUrl
    const granted = isPermissionAllowed(permission, origin)
    if (!granted) {
      logger.info('chat', `permissão negada: ${permission} (${origin ?? 'origem desconhecida'})`)
    }
    callback(granted)
  })

  chatSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    const granted = isPermissionAllowed(permission, requestingOrigin)
    if (!granted) {
      logger.info(
        'chat',
        `permissão negada (check): ${permission} (${requestingOrigin || 'origem desconhecida'})`
      )
    }
    return granted
  })

  // getDisplayMedia: a v1 compartilha sempre a tela primária (sem seletor).
  // Áudio de loopback só no Windows; se falhar, repete sem áudio.
  chatSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!isChatOrigin(request.securityOrigin)) {
      logger.info(
        'chat',
        `compartilhamento de tela negado para ${request.securityOrigin || 'origem desconhecida'}`
      )
      callback({})
      return
    }

    void desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const primary = sources[0]
        if (!primary) {
          logger.warn('chat', 'compartilhamento de tela sem fonte disponível')
          callback({})
          return
        }
        try {
          callback({ video: primary, audio: 'loopback' })
        } catch {
          logger.info('chat', 'áudio de loopback indisponível; compartilhando tela sem áudio')
          callback({ video: primary })
        }
      })
      .catch((err: unknown) => {
        logger.warn(
          'chat',
          `falha ao listar as telas: ${err instanceof Error ? err.message : String(err)}`
        )
        callback({})
      })
  })

  chatSession.on('will-download', (event) => {
    event.preventDefault()
    logger.info('chat', 'download cancelado: a página Chat não baixa arquivos')
  })
}

/** Abre no navegador do sistema só esquemas que o Hub já permite. */
function openExternal(url: string): void {
  if (isAllowedExternalUrl(url)) {
    logger.info('chat', `link externo aberto no navegador: ${url}`)
    void shell.openExternal(url)
    return
  }
  logger.warn('chat', `link externo bloqueado (esquema não permitido): ${url}`)
}

/** Navegação/redirect do guest: allowlist do site, externo no navegador, resto barrado. */
function handleGuestNavigation(event: ElectronEvent, url: string): void {
  const decision = classifyChatNavigation(url)
  if (decision === 'allow') return

  event.preventDefault()
  if (decision === 'external') {
    openExternal(url)
    return
  }
  logger.warn('chat', `navegação bloqueada: ${url}`)
}

/**
 * Endurece o `<webview>` anexado à janela principal: valida o `src`, remove o
 * preload e força isolamento/sandbox no guest. `webviewTag` fica `false` no
 * guest para impedir webviews aninhados.
 */
export function installChatGuards(window: BrowserWindow): void {
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isChatUrl(params.src)) {
      event.preventDefault()
      logger.warn('chat', `webview bloqueado (src fora da allowlist): ${params.src}`)
      return
    }

    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webviewTag = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.allowRunningInsecureContent = false

    params.partition = CHAT_PARTITION
    delete params.allowpopups
  })

  window.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      const decision = classifyChatNavigation(url)
      if (decision === 'external') {
        openExternal(url)
      } else {
        logger.info('chat', `popup bloqueado: ${url}`)
      }
      return { action: 'deny' }
    })

    guest.on('will-navigate', (event, url) => handleGuestNavigation(event, url))
    guest.on('will-redirect', (event, url) => handleGuestNavigation(event, url))
  })
}
