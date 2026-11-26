// PRIMEIRO import: isola userData em smoke/teste antes de qualquer efeito
// colateral (crashReporter, logger, electron-store).
import './testUserData'
// Efeito colateral intencional: inicia o crashReporter local
// (uploadToServer: false) e registra os handlers de crash antes da avaliação de
// qualquer outro módulo do main.
import './crashReporting'
import { app, screen, Tray } from 'electron'
import { registerIpc } from './ipc'
import type { IpcContext } from './ipc'
import { setThemeFromRequest } from './ipc/theme'
import { isQuitting, markQuitting } from './quitState'
import { getStoreSnapshot } from './store'
import { logger } from './logger'
import { getUsageMeter } from './gemini/instance'
import { createTray } from './tray/tray'
import { isFirstRun, markFirstRunComplete } from './firstRun'
import { getMainWindow, showMainWindow } from './lifecycle'
import { shutdownApp } from './shutdown'
import { handleSecondInstance } from './singleInstance'
import { getOverlayWindow, isOverlayVisible } from './overlay/overlayWindow'
import {
  getOverlayStatus,
  initializeOverlay,
  showOverlay,
  toggleOverlay
} from './overlay/controller'

// Referência viva obrigatória: o GC do Node destrói o ícone da bandeja se a
// instância só existir em variável local.
let tray: Tray | null = null

/**
 * Contexto dos módulos IPC. A janela é lida por getter (criada sob demanda em
 * lifecycle.ts) e o overlay agora devolve a janela real (task 02).
 */
const ctx: IpcContext = {
  getMainWindow,
  getOverlayWindow,
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
 * "Configurações" abre a janela principal na rota `#settings`. A janela é a
 * mesma da fundação (task 00) e agora carrega a aba Aparência.
 */
function openSettings(): void {
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

/** Loga visibilidade e bounds reais do overlay no smoke. */
function logOverlaySmoke(label: string): void {
  const window = getOverlayWindow()
  const status = getOverlayStatus()
  const bounds = window && !window.isDestroyed() ? window.getBounds() : null
  logger.info('lifecycle', `smoke: overlay ${label}`, {
    visible: isOverlayVisible(),
    autoHidden: status.autoHidden,
    window: window !== null,
    bounds
  })
}

/**
 * Smoke de runtime (dev/teste): prova o ciclo oculto -> visível -> oculto pelo
 * clique da bandeja e encerra. Só roda com ABSOLEM_SMOKE=1 e fora do app
 * empacotado; em produção a env var não existe e o build instalado nunca entra
 * neste caminho.
 */
function scheduleSmoke(): void {
  if (app.isPackaged || process.env.ABSOLEM_SMOKE !== '1') return
  let themeSentAt = 0
  setTimeout(() => {
    logger.info('lifecycle', 'smoke: estado no boot')
    logger.info('lifecycle', 'smoke: workArea primária', screen.getPrimaryDisplay().workArea)
    logger.info('lifecycle', 'smoke: tema persistido no boot', {
      presetId: ctx.getStoreSnapshot().theme.presetId,
      primaryColor: ctx.getStoreSnapshot().theme.primaryColor
    })
    logOverlaySmoke('boot')
  }, 400)
  setTimeout(() => {
    // Prova a persistência de `usage`: no segundo smoke com o mesmo
    // ABSOLEM_TEST_USERDATA, `before` já traz os tokens do primeiro.
    const before = getUsageMeter().snapshot()
    const after = getUsageMeter().record({ input: 3, output: 2 })
    logger.info('lifecycle', 'smoke: usage (boot -> record)', { before, after })
  }, 500)
  setTimeout(() => {
    logger.info('lifecycle', 'smoke: simulando clique esquerdo na bandeja')
    tray?.emit('click')
    logOverlaySmoke('após clique 1')
  }, 1000)
  setTimeout(() => {
    logOverlaySmoke('aberto')
  }, 1400)
  setTimeout(() => {
    // Prova o push `theme:changed` sem gravar no config de teste.
    themeSentAt = Date.now()
    const result = setThemeFromRequest(ctx, {
      theme: { presetId: 'custom', primaryColor: '#22d3ee' },
      persist: false
    })
    logger.info('lifecycle', 'smoke: theme:set', result)
  }, 1600)
  setTimeout(() => {
    const window = getOverlayWindow()
    if (!window) {
      logger.warn('lifecycle', 'smoke: overlay ausente ao ler o tema')
      return
    }
    void window.webContents
      .executeJavaScript(
        `(() => ({
          presetId: document.querySelector('[data-theme-preset]')?.getAttribute('data-theme-preset') ?? '',
          receivedAt: Number(document.documentElement.dataset.themeReceivedAt ?? 0)
        }))()`
      )
      .then((info: unknown) => {
        const received = info as { presetId?: unknown; receivedAt?: unknown }
        const presetId = typeof received.presetId === 'string' ? received.presetId : ''
        const receivedAt = typeof received.receivedAt === 'number' ? received.receivedAt : 0
        logger.info('lifecycle', 'smoke: theme:changed no overlay', {
          presetId,
          applied: presetId === 'custom',
          latencyMs: receivedAt > 0 && themeSentAt > 0 ? receivedAt - themeSentAt : -1
        })
      })
      .catch((err: unknown) => {
        logger.warn('lifecycle', 'smoke: falha ao ler o tema do overlay', err)
      })
  }, 2000)
  setTimeout(() => {
    // Persistência real no userData temporário: uma segunda execução do smoke
    // com o mesmo ABSOLEM_TEST_USERDATA deve logar `jade` no boot.
    const result = setThemeFromRequest(ctx, {
      theme: { presetId: 'jade', primaryColor: '#10b981' }
    })
    logger.info('lifecycle', 'smoke: tema persistido', result)
  }, 2100)
  setTimeout(() => {
    // Prova os canais do motor sem chave e sem rede: `gemini:status` lê o
    // estado local; `diagnostics:gemini` devolve metadados (nunca a chave).
    const window = getOverlayWindow()
    if (!window) {
      logger.warn('lifecycle', 'smoke: overlay ausente ao ler gemini:status')
      return
    }
    void window.webContents
      .executeJavaScript(
        `(async () => ({
          status: await window.absolem.gemini.status(),
          diagnostics: await window.absolem.diagnostics.gemini()
        }))()`
      )
      .then((info: unknown) => {
        logger.info('lifecycle', 'smoke: gemini:status + diagnostics:gemini', info)
      })
      .catch((err: unknown) => {
        logger.warn('lifecycle', 'smoke: falha ao ler gemini:status', err)
      })
  }, 2450)
  setTimeout(() => {
    logger.info('lifecycle', 'smoke: abrindo Configurações (rota #settings)')
    showMainWindow()
  }, 2200)
  setTimeout(() => {
    const window = getMainWindow()
    if (!window || window.isDestroyed()) {
      logger.warn('lifecycle', 'smoke: janela de Configurações ausente')
      return
    }
    void window.webContents
      .executeJavaScript(
        `(() => {
          const controls = Array.from(document.querySelectorAll('input, select'))
          const labelled = controls.filter((el) => el.id && document.querySelector('label[for="' + el.id + '"]'))
          return {
            hash: location.hash,
            title: document.querySelector('h1')?.textContent ?? '',
            primaryColor: document.querySelector('#appearance-primary-color') !== null,
            controls: controls.length,
            labelled: labelled.length
          }
        })()`
      )
      .then((info: unknown) => {
        logger.info('lifecycle', 'smoke: Configurações carregada', info)
      })
      .catch((err: unknown) => {
        logger.warn('lifecycle', 'smoke: falha ao ler a janela de Configurações', err)
      })
  }, 2700)
  setTimeout(() => {
    logger.info('lifecycle', 'smoke: simulando segundo clique (fechar)')
    tray?.emit('click')
    logOverlaySmoke('após clique 2')
  }, 3100)
  setTimeout(() => {
    logOverlaySmoke('oculto')
  }, 3400)
  setTimeout(() => {
    logger.info('lifecycle', 'smoke: solicitando encerramento')
    requestQuit()
  }, 3800)
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

  // screen/globalShortcut exigem app pronto: o controlador só nasce aqui.
  initializeOverlay(ctx)

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
