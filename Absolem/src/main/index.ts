// PRIMEIRO import: isola userData em smoke/teste antes de qualquer efeito
// colateral (crashReporter, logger, electron-store).
import './testUserData'
// Efeito colateral intencional: inicia o crashReporter local
// (uploadToServer: false) e registra os handlers de crash antes da avaliação de
// qualquer outro módulo do main.
import './crashReporting'
import { app, Tray } from 'electron'
import { registerIpc } from './ipc'
import type { IpcContext } from './ipc'
import { isQuitting, markQuitting } from './quitState'
import { getStoreSnapshot } from './store'
import { logger } from './logger'
import { createTray } from './tray/tray'
import { isFirstRun, markFirstRunComplete } from './firstRun'
import { getMainWindow, showMainWindow } from './lifecycle'
import { shutdownApp } from './shutdown'
import { handleSecondInstance } from './singleInstance'

// Referência viva obrigatória: o GC do Node destrói o ícone da bandeja se a
// instância só existir em variável local.
let tray: Tray | null = null
// Estado pedido pelo usuário neste task (sem overlay real ainda): só serve
// para o log de ciclo de vida distinguir abrir de fechar no toggle.
let overlayRequestedVisible = false

/**
 * Contexto dos módulos IPC. A janela é lida por getter (criada sob demanda em
 * lifecycle.ts); o overlay entra na task 02 e por isso ainda devolve null.
 */
const ctx: IpcContext = {
  getMainWindow,
  getOverlayWindow: () => null,
  getStoreSnapshot,
  isQuitting
}

/** Balão da bandeja; falha de plataforma nunca derruba o app. */
function showTrayBalloon(content: string): void {
  if (!tray) return
  try {
    tray.displayBalloon({ title: 'Absolem', content })
  } catch (err) {
    logger.warn('tray', 'falha ao exibir balão da bandeja', err)
  }
}

/**
 * "Abrir Overlay" ainda não tem overlay (task 02): registra a solicitação e
 * avisa pelo balão. Substituído pelo controlador real na próxima task.
 */
function showOverlay(): void {
  overlayRequestedVisible = true
  logger.info('tray', 'abrir overlay solicitado')
  logger.info('lifecycle', 'overlay abrir solicitado')
  showTrayBalloon('O overlay chega na próxima etapa.')
}

/** Clique esquerdo no ícone: alterna o overlay (task 02). */
function toggleOverlay(): void {
  overlayRequestedVisible = !overlayRequestedVisible
  logger.info('tray', 'toggle solicitado')
  logger.info('lifecycle', `overlay ${overlayRequestedVisible ? 'abrir' : 'fechar'} solicitado`)
  showTrayBalloon('O overlay chega na próxima etapa.')
}

/**
 * "Configurações" mostra a janela de fundação existente. Paliativo documentado
 * até a task 11 criar a tela real de configurações.
 */
function openSettings(): void {
  // TODO(task 11): abrir a janela de configurações real
  showMainWindow()
}

function requestQuit(): void {
  shutdownApp(ctx, 'tray')
}

// Instância única: o lock é pedido antes de qualquer bootstrap. Sem o lock a
// segunda instância encerra sem criar janela, sem IPC e sem tocar no disco.
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    handleSecondInstance({
      showOverlay,
      notify: () => showTrayBalloon('Absolem já está em execução.')
    })
  })
} else {
  app.quit()
}

/**
 * Smoke de runtime (dev/teste): simula o clique esquerdo na bandeja e encerra.
 * Só roda com ABSOLEM_SMOKE=1 e fora do app empacotado; em produção a env var
 * não existe e o build instalado nunca entra neste caminho.
 */
function scheduleSmoke(): void {
  if (app.isPackaged || process.env.ABSOLEM_SMOKE !== '1') return
  setTimeout(() => {
    logger.info('lifecycle', 'smoke: simulando clique esquerdo na bandeja')
    tray?.emit('click')
  }, 1000)
  setTimeout(() => {
    logger.info('lifecycle', 'smoke: simulando segundo clique (fechar)')
    tray?.emit('click')
  }, 1600)
  setTimeout(() => {
    logger.info('lifecycle', 'smoke: solicitando encerramento')
    requestQuit()
  }, 2400)
}

app.whenReady().then(() => {
  // Lock negado: o app.quit() acima já encerra; nada de bootstrap.
  if (!gotSingleInstanceLock) return

  // Precisa vir antes da bandeja: displayBalloon depende do AppUserModelId.
  app.setAppUserModelId('com.kolnd.absolem')

  const hidden = process.argv.includes('--hidden')
  logger.info('lifecycle', `iniciando (${hidden ? '--hidden' : 'normal'})`)

  registerIpc(ctx)

  tray = createTray({
    showOverlay,
    toggleOverlay,
    openSettings,
    quit: requestQuit
  })
  logger.info('lifecycle', 'bandeja criada')

  if (isFirstRun()) {
    logger.info('lifecycle', 'firstRun: true')
    showTrayBalloon('Absolem está na bandeja. Botão direito > Abrir Overlay.')
    try {
      markFirstRunComplete()
    } catch (err) {
      logger.warn('firstRun', 'falha ao gravar a flag de primeira execução', err)
    }
  }

  scheduleSmoke()
})

if (gotSingleInstanceLock) {
  // Fechar a janela não encerra o app: ele continua na bandeja.
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    markQuitting()
  })

  app.on('activate', () => {
    showMainWindow()
  })
}
