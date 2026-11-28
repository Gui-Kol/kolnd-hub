// PRIMEIRO import: limpa `ELECTRON_RENDERER_URL` no app empacotado antes de
// qualquer janela ser criada (o Hub em dev exporta a URL DELE, e as janelas do
// Absolem acabavam carregando a página do Hub).
import './rendererEnv'
// Isola userData em smoke/teste antes de qualquer efeito colateral
// (crashReporter, logger, electron-store).
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
import { getUsageMeter, getGeminiEngine } from './gemini/instance'
import { getSearchRuntime } from './search/instance'
import { extractReadable } from './search/extract'
import { getActionsRuntime } from './actions/instance'
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
import { scheduleVisualCapture } from './visual/capture'

// O launcher pode nos iniciar com stdout/stderr ligados a um pipe e fechar
// esse pipe depois (o Hub em dev faz isso ao encerrar). Sem um listener de
// `error`, o `EPIPE: broken pipe, write` emitido pelo stream sobe como exceção
// não capturada e derruba o processo justo durante um `logger.info`. O handler
// vazio transforma a falha de escrita em silêncio: log em arquivo continua.
process.stdout.on('error', () => {})
process.stderr.on('error', () => {})

// Referência viva obrigatória: o GC do Node destrói o ícone da bandeja se a
// instância só existir em variável local.
let tray: Tray | null = null

// Sandbox do Chromium para TODOS os renderers. Precisa ser chamado antes de
// `app.whenReady`; as três janelas também declaram `sandbox:true` no
// webPreferences, mas esta chamada fecha a porta para uma janela futura que
// esqueça a flag. O preload usa só contextBridge/ipcRenderer, compatível com
// sandbox.
app.enableSandbox()

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
      notify: () => showTrayBalloon('Absolem já está em execução.'),
      isQuitting
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
    // Prova que o parser (linkedom bundlado) roda no Node 18 do Electron 28,
    // inclusive o motor de seletores (css-select é declarado para Node 20+).
    try {
      const page = extractReadable(
        '<html><head><title>Smoke</title></head><body><article><h1>Título</h1><p>Texto extraído.</p></article><script>ignorar()</script></body></html>'
      )
      logger.info('lifecycle', 'smoke: extractReadable', {
        title: page.title,
        chars: page.chars,
        hasText: page.text.includes('Texto extraído.')
      })
    } catch (err) {
      logger.error('lifecycle', 'smoke: extractReadable falhou', err)
    }
  }, 450)
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
    // Voz sem chave: `voice:status` responde localmente e `voice:start` vira
    // `error`/auth sem abrir microfone nem rede. Com chave configurada o smoke
    // nunca inicia captura (o teste manual cobre o caminho real).
    const window = getOverlayWindow()
    if (!window) {
      logger.warn('lifecycle', 'smoke: overlay ausente ao ler voice:status')
      return
    }
    const configured = getGeminiEngine().isConfigured()
    const script = configured
      ? `(async () => ({ status: await window.absolem.voice.status(), start: 'ignorado (chave configurada)' }))()`
      : `(async () => ({ status: await window.absolem.voice.status(), start: await window.absolem.voice.start(), after: await window.absolem.voice.status() }))()`
    void window.webContents
      .executeJavaScript(script)
      .then((info: unknown) => {
        logger.info('lifecycle', 'smoke: voice:status + voice:start sem chave', info)
      })
      .catch((err: unknown) => {
        logger.warn('lifecycle', 'smoke: falha ao exercitar a voz', err)
      })
  }, 2500)
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
    // Visão de tela: com o default `privacy.screen.mode = 'off'`, o status
    // aparece, mas `capture:ask` e `capture:region` são recusados sem capturar
    // e sem abrir janela de seleção. O teste manual cobre os modos ligados.
    const window = getOverlayWindow()
    if (!window) {
      logger.warn('lifecycle', 'smoke: overlay ausente ao ler capture:status')
      return
    }
    void window.webContents
      .executeJavaScript(
        `(async () => ({
          status: await window.absolem.capture.status(),
          ask: await window.absolem.capture.ask({ requestId: 'smoke-capture', kind: 'screen', question: 'olha minha tela' }),
          region: await window.absolem.capture.region()
        }))()`
      )
      .then((info: unknown) => {
        logger.info('lifecycle', 'smoke: capture:status + recusas em modo off', info)
      })
      .catch((err: unknown) => {
        logger.warn('lifecycle', 'smoke: falha ao exercitar a visão de tela', err)
      })
  }, 2950)
  setTimeout(() => {
    // Ações: prova os defaults (system.power=deny), a pausa alternando e que
    // nenhuma ferramenta de ação é chamada por este smoke.
    const window = getOverlayWindow()
    if (!window) {
      logger.warn('lifecycle', 'smoke: overlay ausente ao ler permissions:get')
      return
    }
    void window.webContents
      .executeJavaScript(
        `(async () => {
          const before = await window.absolem.permissions.get()
          const statusBefore = await window.absolem.actions.status()
          const pauseOn = await window.absolem.actions.pause(true)
          const during = await window.absolem.actions.status()
          const pauseOff = await window.absolem.actions.pause(false)
          const after = await window.absolem.actions.status()
          return { before, statusBefore, pauseOn, during, pauseOff, after }
        })()`
      )
      .then((info: unknown) => {
        logger.info('lifecycle', 'smoke: permissions:get + actions:pause/status', info)
      })
      .catch((err: unknown) => {
        logger.warn('lifecycle', 'smoke: falha ao exercitar permissões/pausa', err)
      })
  }, 3200)
  setTimeout(() => {
    // Pesquisa na internet: default ligado, `search:status` responde e, com
    // `web.enabled=false`, as duas ferramentas somem do registro. Restaura no
    // fim para não deixar o userData de teste desligado.
    const window = getOverlayWindow()
    if (!window) {
      logger.warn('lifecycle', 'smoke: overlay ausente ao ler search:status')
      return
    }
    void window.webContents
      .executeJavaScript(
        `(async () => {
          const before = await window.absolem.search.status()
          const disabled = await window.absolem.storeSet('web', { enabled: false })
          const off = await window.absolem.search.status()
          const restored = await window.absolem.storeSet('web', { enabled: true })
          const after = await window.absolem.search.status()
          const cache = await window.absolem.search.clearCache()
          return { before, disabled, off, restored, after, cache }
        })()`
      )
      .then((info: unknown) => {
        logger.info('lifecycle', 'smoke: search:status ligado/desligado', info)
      })
      .catch((err: unknown) => {
        logger.warn('lifecycle', 'smoke: falha ao exercitar search:status', err)
      })
  }, 3350)
  setTimeout(() => {
    logger.info('lifecycle', 'smoke: simulando segundo clique (fechar)')
    tray?.emit('click')
    logOverlaySmoke('após clique 2')
  }, 3450)
  setTimeout(() => {
    logOverlaySmoke('oculto')
  }, 3750)
  setTimeout(() => {
    logger.info('lifecycle', 'smoke: solicitando encerramento')
    requestQuit()
  }, 4100)
}

/**
 * Smoke do app empacotado: prova que o módulo nativo do SQLite carrega e que
 * `memory:stats` responde no renderer (preload + IPC + banco). Só roda com
 * `ABSOLEM_MEMORY_SMOKE=1`; não existe em produção.
 */
function scheduleMemorySmoke(): void {
  if (process.env.ABSOLEM_MEMORY_SMOKE !== '1') return
  let attempts = 0
  const run = (): void => {
    attempts += 1
    const window = getOverlayWindow()
    if (!window || window.isDestroyed()) {
      if (attempts === 1) showOverlay()
      if (attempts < 20) {
        setTimeout(run, 250)
        return
      }
      logger.warn('lifecycle', 'smoke: overlay ausente para memory:stats')
      requestQuit()
      return
    }
    void window.webContents
      .executeJavaScript('window.absolem.memory.stats()')
      .then((info: unknown) => {
        logger.info('lifecycle', 'smoke: memory:stats', info)
      })
      .catch((err: unknown) => {
        logger.warn('lifecycle', 'smoke: falha em memory:stats', err)
      })
      .finally(() => {
        setTimeout(requestQuit, 400)
      })
  }
  setTimeout(run, 1200)
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
  // Energia sempre avisa por balão; a bandeja nasce depois do runtime de ações.
  getActionsRuntime()?.setNotifier(showTrayBalloon)

  // screen/globalShortcut exigem app pronto: o controlador só nasce aqui.
  // No harness visual o auto-hide por tela cheia é desligado: o ambiente de
  // captura pode ter uma janela fullscreen e esconderia o overlay no meio.
  initializeOverlay(
    ctx,
    process.env.ABSOLEM_VISUAL_DIR && !app.isPackaged ? { hideOnFullscreen: false } : {}
  )

  if (isFirstRun()) {
    logger.info('lifecycle', 'firstRun: true')
    showTrayBalloon('Absolem está na bandeja. Botão direito > Abrir Overlay.')
    // Primeira configuração sem chave: abre direto em "Chave e custo".
    if (!hidden && !getGeminiEngine().isConfigured()) {
      logger.info('lifecycle', 'firstRun: abrindo Configurações na aba Chave e custo')
      showMainWindow('key')
    }
    try {
      markFirstRunComplete()
    } catch (err) {
      logger.warn('firstRun', 'falha ao gravar a flag de primeira execução', err)
    }
  }

  scheduleSmoke()
  scheduleMemorySmoke()
  // Evidência visual (task 23): só existe com ABSOLEM_VISUAL_DIR e fora do
  // empacotado. Reaproveita o mesmo showOverlay da bandeja.
  scheduleVisualCapture(ctx, requestQuit)
})

if (gotSingleInstanceLock) {
  // Fechar a janela não encerra o app: ele continua na bandeja.
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    markQuitting()
  })

  // Cache de páginas é só memória; ao sair, nada permanece.
  app.on('will-quit', () => {
    getSearchRuntime()?.shutdown()
  })

  app.on('activate', () => {
    showMainWindow()
  })
}
