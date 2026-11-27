// PRIMEIRO import: efeito colateral intencional — inicia o crashReporter local
// (uploadToServer: false) e registra os handlers de crash ANTES de qualquer
// outro módulo do main ser avaliado (ver src/main/crashReporting.ts).
import './crashReporting'
import { registerChildProcessCleanup } from './crashReporting'
import { app, shell, BrowserWindow, Tray, Menu, nativeImage, powerMonitor } from 'electron'
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'path'
import { existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { ProcessManager, setBaseDir } from './processManager'
import { isFirstRun } from './firstRun'
import { registerSystemIpc } from './ipc/system'
import { registerStartupIpc } from './ipc/startup'
import { registerLoginItemIpc } from './loginItem'
import { registerFirstRunIpc as registerFirstRunStatusIpc } from './ipc/firstRun'
import { registerFirstRunIpc as registerFirstRunInstallerIpc } from './firstRunInstaller'
import { registerConfigIpc, registerPrefsIpc, getConfigSnapshot, getUsageLogPrefs } from './store'
import { registerGamepadIpc } from './gamepad'
import { registerWingetIpc } from './wingetUpdater'
import { registerTempCleanerIpc } from './tempCleaner'
import { registerRamMonitorIpc } from './ramMonitor'
import { registerRamOptimizerIpc } from './ramOptimizer'
import { registerRamAutoIpc, startRamAutoOptimizer, stopRamAutoOptimizer } from './ramAutoOptimizer'
import { registerBenchmarkIpc } from './benchmark'
import {
  registerHwMonitorIpc,
  setHwPollingSystemSuspended,
  setHwPollingWindowVisible
} from './hwmon'
import { registerDisplayIpc } from './displaySettings'
import { registerHudIpc } from './hud'
import { registerFpsIpc, startFpsCapture } from './fps'
import { registerUninstallIpc, isAnyUninstallInProgress } from './uninstaller'
import { registerGamesIpc, repairGameIconsIfNeeded, flushPlaytimeTracking } from './games'
import { registerCommandValidateIpc } from './commandValidate'
import { registerGameImportIpc } from './gameImport'
import { registerShellIpc, isAllowedExternalUrl } from './ipc/shell'
import { registerDialogIpc } from './ipc/dialog'
import { registerWindowIpc } from './ipc/window'
import { registerAppIpc } from './ipc/app'
import { registerKloudGamesIpc } from './ipc/kloudGames'
import { registerRemoteAccessIpc } from './ipc/remoteAccess'
import { registerUpdatesIpc } from './ipc/updates'
import { registerUninstallHubIpc } from './ipc/uninstall'
import { registerProcessEvents } from './ipc/processEvents'
import { registerProcessWatchIpc } from './ipc/processWatch'
import { stopProcessWatch } from './processWatch'
import { registerDiagnosticIpc } from './ipc/diagnostic'
import { registerConfigTransferIpc } from './ipc/configTransfer'
import { registerUsageIpc } from './ipc/usage'
import { configureChatSession, installChatGuards } from './chat'
import {
  appendUsageEvent,
  buildUsageEvent,
  setUsageEnabledProvider,
  setUsageRetentionProvider
} from './usageLog'
import type { IpcContext } from './ipc/lifecycle'
import { isQuitting, markQuitting } from './quitState'
import { logger } from './logger'

/**
 * Hook de teste (E2E, task 04-4.1): isola o diretório userData (%APPDATA%\\kolnd-hub)
 * quando a env var `KOLDND_HUB_TEST_USERDATA` está definida (ex.: smoke do Playwright).
 * Deve rodar ANTES de qualquer `app.getPath('userData')` e de `app.whenReady()`.
 * Sem a env var não tem efeito algum — em produção o caminho padrão é usado.
 */
const testUserData = process.env.KOLDND_HUB_TEST_USERDATA
if (testUserData) {
  app.setPath('userData', testUserData)
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

// Registro de uso local (task logs-uso-detalhados): uma sessão por execução do
// Hub. O id é aleatório e nenhum dado sensível entra no arquivo.
const usageSessionId = randomUUID()
let usageSessionStartedAt: number | null = null
let usageSessionEnded = false

function startUsageSession(): void {
  usageSessionStartedAt = Date.now()
  appendUsageEvent(
    buildUsageEvent('session-start', { sessionId: usageSessionId, version: app.getVersion() })
  )
}

/** Fecha a sessão uma única vez (before-quit pode disparar mais de uma vez). */
function endUsageSession(): void {
  if (usageSessionEnded) return
  usageSessionEnded = true
  if (usageSessionStartedAt === null) return
  const durationSeconds = Math.max(0, Math.round((Date.now() - usageSessionStartedAt) / 1000))
  appendUsageEvent(buildUsageEvent('session-end', { sessionId: usageSessionId, durationSeconds }))
}
// Auto-restart (06-6.4) e log persistente (05-5.7): o ProcessManager NÃO importa
// o store — a preferência por app é resolvida aqui, via `getAppPrefs(appId)`, e
// injetada no launch. Default false nos dois (opt-in por app em
// Configurações → Gerenciador de títulos).
const processManager = new ProcessManager({
  getAppPrefs: (appId) => {
    const app = getConfigSnapshot().apps?.find((a) => a.id === appId)
    return {
      autoRestart: app?.autoRestart === true,
      persistLogs: app?.persistLogs === true
    }
  }
})

// Crash do main: os filhos do Hub (servidores, Kloud Games, ...) não podem ficar
// órfãos — o relançamento não os rastrearia e criaria uma segunda instância.
// O killAllSync roda de forma síncrona dentro do handler de uncaughtException.
registerChildProcessCleanup(() => processManager.killAllSync())

// Contexto compartilhado dos módulos IPC (ipc/*.ts): janela principal via
// getter (mainWindow é reassinado em createWindow) + o ProcessManager.
const ctx: IpcContext = {
  getMainWindow: () => mainWindow,
  processManager
}

// Instância única: o lock é pedido antes de qualquer bootstrap. Se outra
// instância já o segura, encerra imediatamente — sem criar janela/tray, sem
// registrar handlers de limpeza/desinstalação e sem tocar no disco.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
} else {
  app.quit()
}

let postWindowWorkDone = false

/**
 * Reparo de ícones: fora do caminho crítico da janela. Roda uma vez por sessão,
 * depois de `ready-to-show`, mantendo os mesmos gates de versão/idempotência de
 * quando era aguardado antes de criar a janela.
 */
function runPostWindowWork(): void {
  if (postWindowWorkDone) return
  postWindowWorkDone = true
  logger.info('window', 'janela pronta: reparo de ícones em segundo plano')
  void repairGameIconsIfNeeded().then((repaired) => {
    logger.info('games', `reparo de ícones pós-abertura concluído (${repaired} regravado(s))`)
  })
}

function createWindow(isFirstRunMode = false, startHidden = false): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Só a janela principal pode criar o <webview> do Chat; o guest recebe
      // `webviewTag: false` em `installChatGuards` (ver src/main/chat.ts).
      webviewTag: true
    }
  })

  // Valida o src, remove o preload e força isolamento/sandbox no guest.
  installChatGuards(mainWindow)

  // O polling do monitor só roda com alguém olhando: X para a bandeja oculta a
  // janela e pausa o timer (o HUD, se visível, mantém). `--hidden` nasce oculta
  // e o estado inicial precisa refletir isso — `show` só dispara ao aparecer.
  setHwPollingWindowVisible(false)
  mainWindow.on('show', () => setHwPollingWindowVisible(true))
  mainWindow.on('hide', () => setHwPollingWindowVisible(false))

  mainWindow.on('ready-to-show', () => {
    // --hidden (autostart do Hub no Windows): a janela fica viva e oculta —
    // a bandeja a exibe via "Abrir Kolnd Hub"/clique.
    if (!startHidden) mainWindow!.show()
    // Trabalho best-effort que não precisa estar no caminho da primeira
    // pintura (reparo de ícones) roda aqui, uma vez por sessão, DEPOIS que a
    // janela já está pronta.
    runPostWindowWork()
  })

  // X do title bar, Alt+F4 e o close do SO ocultam para a bandeja em vez de
  // encerrar. O fechamento real só passa quando o Sair explícito (Mais →
  // Encerrar Hub ou Sair da bandeja) marcou `isQuitting()`. O handler vive
  // AQUI (dentro de createWindow) porque em `whenReady` a janela ainda não
  // existe — era o bug que deixava o Alt+F4 sem interceptação.
  mainWindow.on('close', (event) => {
    if (isQuitting()) return
    event.preventDefault()
    // Desinstalação destrutiva: X/Alt+F4 fica inerte (não oculta, não encerra).
    if (isAnyUninstallInProgress()) return
    logger.info('window', 'janela ocultada para a bandeja')
    mainWindow?.hide()
  })

  // Desligamento/logoff do Windows: marca a saída antes de o close ser
  // interceptado, para não segurar o shutdown do SO.
  mainWindow.on('session-end', markQuitting)
  // `query-session-end` (Windows) existe no runtime do Electron, mas ainda não
  // está nas typings do Electron 28; registra via EventEmitter mínimo.
  ;(mainWindow as unknown as NodeJS.EventEmitter).on('query-session-end', markQuitting)

  // Diagnóstico de UI travada: o Chromium emite `unresponsive` quando o
  // renderer fica segundos sem processar o event loop (ex.: carga pesada de
  // CPU). Antes disso o sintoma só aparecia como "o Hub parou de funcionar"
  // sem nenhuma pista no log.
  mainWindow.on('unresponsive', () => {
    logger.warn('window', 'janela não respondeu (renderer ocupado)')
  })
  mainWindow.on('responsive', () => {
    logger.info('window', 'janela voltou a responder')
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalUrl(details.url)) {
      shell.openExternal(details.url)
    } else {
      logger.warn('window', `setWindowOpenHandler: bloqueado esquema não permitido: ${details.url}`)
    }
    return { action: 'deny' }
  })

  // Bloqueia navegação in-window (clique em link, redirect, meta refresh,
  // injeção de script): a janela seguiria com o preload exposto no contexto
  // remoto. Em dev, permite apenas a origem do dev server (HMR do
  // electron-vite); em produção (loadFile), bloqueia tudo.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      try {
        if (new URL(url).origin === new URL(process.env['ELECTRON_RENDERER_URL']).origin) {
          return
        }
      } catch {
        // URL inválida: cai no bloqueio padrão abaixo.
      }
    }
    event.preventDefault()
    logger.warn('window', `will-navigate bloqueado: ${url}`)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    if (isFirstRunMode) url.searchParams.set('first-run', '1')
    mainWindow.loadURL(url.toString())
  } else {
    const htmlPath = join(__dirname, '../renderer/index.html')
    if (isFirstRunMode) {
      mainWindow.loadFile(htmlPath, { query: { 'first-run': '1' } })
    } else {
      mainWindow.loadFile(htmlPath)
    }
  }
}

/**
 * Caminho do ícone da bandeja (resources/tray-icon.png, 32×32).
 * Mesmo padrão de `getKloudGamesDir()`: resourcesPath em produção (o arquivo
 * chega à raiz de resources/ via extraResources no electron-builder.yml),
 * cwd/resources em dev.
 */
function trayIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'tray-icon.png')
  }
  return join(process.cwd(), 'resources', 'tray-icon.png')
}

/**
 * Mostra/foca a janela principal para a bandeja e o `activate`. Se a janela
 * foi destruída (não é o caminho normal — o X só oculta), recria para não
 * deixar o app vivo sem interface.
 */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = null
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/**
 * Bloqueio de tela e suspensão do PC: ninguém está olhando os números. O polling
 * do monitor para sem perder os consumidores e, ao voltar (`unlock-screen` /
 * `resume`), faz uma coleta imediata antes de reagendar. Idempotente — o Windows
 * pode emitir `unlock-screen` e `resume` juntos.
 */
function registerPowerMonitorWiring(): void {
  powerMonitor.on('lock-screen', () => setHwPollingSystemSuspended(true))
  powerMonitor.on('suspend', () => setHwPollingSystemSuspended(true))
  powerMonitor.on('unlock-screen', () => setHwPollingSystemSuspended(false))
  powerMonitor.on('resume', () => setHwPollingSystemSuspended(false))
}

function createTray(): void {
  // Ícone da bandeja como asset em disco (não mais blob base64 inline). Se o
  // arquivo não existir, usa imagem vazia + aviso no log — o app nunca cai
  // por causa do ícone.
  const iconPath = trayIconPath()
  let icon = nativeImage.createEmpty()
  if (existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath)
  } else {
    logger.warn('tray', `ícone da bandeja não encontrado em ${iconPath}; usando imagem vazia`)
  }

  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Kolnd Hub',
      click: (): void => {
        showMainWindow()
      }
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: async (): Promise<void> => {
        // Durante uma desinstalação destrutiva, o tray não encerra o app
        // (nem mata processos no meio do msiexec/wipe).
        if (isAnyUninstallInProgress()) return
        // Sair explícito: libera o close interceptado antes de encerrar.
        markQuitting()
        // Espera a saída real dos filhos (killAll tem deadline próprio, então
        // nunca trava o quit) e só então pede o quit ao Electron.
        await processManager.killAll()
        app.quit()
      }
    }
  ])

  tray.setToolTip('Kolnd Hub')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    showMainWindow()
  })
}

app.whenReady().then(() => {
  // Sem o lock, o app já recebeu app.quit() e não faz bootstrap nenhum.
  if (!gotSingleInstanceLock) return
  electronApp.setAppUserModelId('com.kolnd.hub')

  // Relative paths in Settings resolve from the project root in dev and from
  // the installation directory once packaged (never from an inherited cwd).
  setBaseDir(is.dev ? process.cwd() : dirname(app.getPath('exe')))

  // Registra os canais IPC da tela de primeira execução.
  registerFirstRunInstallerIpc(() => mainWindow)

  // Registra os canais IPC da config persistente (electron-store).
  registerConfigIpc()

  // Registra os canais IPC das preferências do Hub (ex.: iniciar o Kloud Games junto).
  registerPrefsIpc()

  // Registro de uso local: a preferência (ligado/desligado + retenção) decide
  // se os eventos são gravados. Precisa estar pronto antes do session-start.
  setUsageEnabledProvider(() => getUsageLogPrefs().enabled)
  setUsageRetentionProvider(() => getUsageLogPrefs().retentionDays)
  startUsageSession()

  // Registra os canais IPC de exportação/importação da configuração (07-7.6).
  registerConfigTransferIpc(ctx)

  // Registra os canais IPC do autostart do próprio Hub no Windows (--hidden).
  registerLoginItemIpc()

  // Registra os canais IPC do modo Big Picture (controle + preferências de sons).
  registerGamepadIpc()

  // Registra os canais IPC do winget (listagem de atualizações).
  registerWingetIpc()

  // Registra os canais IPC da limpeza de arquivos temporários.
  registerTempCleanerIpc()

  // Registra o canal IPC do monitor de memória (aba Memória em Meu PC).
  registerRamMonitorIpc()

  // Registra os canais IPC das otimizações de memória por clique (working sets
  // sem UAC e standby list com UAC).
  registerRamOptimizerIpc()

  // Registra a otimização automática de RAM (somente trim, sem UAC) e aplica
  // a preferência persistida — desligada por padrão.
  registerRamAutoIpc()
  startRamAutoOptimizer()

  // Registra os canais IPC do benchmark de CPU e do teste de estresse.
  registerBenchmarkIpc()

  // Registra os canais IPC do monitor de hardware (aba Monitor em Meu PC).
  registerHwMonitorIpc(ctx)

  // Suspensão do polling do monitor quando a tela bloqueia ou o PC suspende.
  registerPowerMonitorWiring()

  // Registra os canais IPC de escala/resolução de tela (aba Tela em Meu PC).
  registerDisplayIpc(ctx)

  // Registra os canais IPC da sobreposição (HUD): atalho global + janela
  // transparente always-on-top. Restaura a preferência persistida.
  registerHudIpc(ctx)

  // Captura de FPS: heartbeat/leitura (Hub aberto) + canais `fps:*` do Monitor.
  // A tarefa elevada só é instalada no primeiro atalho (T5), nunca aqui.
  startFpsCapture()
  registerFpsIpc()

  // Registra os canais IPC da biblioteca de jogos.
  registerGamesIpc()

  // Registra o canal IPC único da busca de jogos (Steam + Epic + Minecraft).
  registerGameImportIpc()

  // Registra os canais IPC de validação de linha de comando (Configurações).
  registerCommandValidateIpc()

  // Registra os canais IPC de shell (abrir navegação externa/caminhos).
  registerShellIpc(ctx)

  // Registra os canais IPC de sistema (nome do PC, processos em execução).
  registerSystemIpc(ctx)

  // Registra os canais IPC de inicialização do PC (startup).
  registerStartupIpc(ctx)

  // Registra os canais IPC de check/markComplete da primeira execução.
  registerFirstRunStatusIpc(ctx)

  // Registra os canais IPC de diálogos nativos (pick-path).
  registerDialogIpc(ctx)

  // Registra os canais IPC de controles de janela (minimize/maximize/fullscreen/close).
  registerWindowIpc(ctx)

  // Registra os canais IPC de gestão de programas (launch/stop/status/logs/shutdown).
  registerAppIpc(ctx)

  // Registra os canais IPC do Kloud Games (launch/status).
  registerKloudGamesIpc(ctx)

  // Registra os canais IPC do acesso remoto (status/instalar/abrir/copiar).
  registerRemoteAccessIpc(ctx)

  // Registra os canais IPC de atualização do app (GitHub Releases).
  registerUpdatesIpc(ctx)

  // Registra o canal IPC de desinstalação do próprio Hub (uninstall:hub).
  registerUninstallHubIpc(ctx)

  // Reencaminha os eventos do ProcessManager para o renderer (status/output).
  registerProcessEvents(ctx)

  // Agendador único das consultas de processos (Dashboard/Biblioteca/BP assinam).
  registerProcessWatchIpc(ctx)

  // Registra o canal IPC de exportação de diagnóstico (diagnostic:export).
  registerDiagnosticIpc(ctx)

  // Registra os canais IPC do registro de uso local (ler/resumir/exportar/limpar).
  registerUsageIpc(ctx)

  // Registra os canais IPC de desinstalação (Kloud Games via msiexec + status do Hub).
  registerUninstallIpc(() => mainWindow)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Sessão do <webview> do Chat: permissões restritas à origem do site. Precisa
  // existir antes do primeiro attach (a janela é criada logo abaixo).
  configureChatSession()

  const firstRun = isFirstRun()
  // --hidden: o Windows lança o Hub com essa flag (args registrados no Run,
  // ver loginItem.ts) para subir direto para a bandeja. Ignorado na primeira
  // execução — o wizard de onboarding sempre aparece.
  const startHidden = process.argv.includes('--hidden') && !firstRun
  if (startHidden) {
    logger.info('window', 'Iniciado com --hidden: janela oculta, apenas a bandeja')
  }

  // A janela abre JÁ: o reparo de ícones roda depois do `ready-to-show`
  // (ver runPostWindowWork), fora do caminho da primeira pintura.
  createWindow(firstRun, startHidden)
  createTray()
})

// Handlers de ciclo de vida: só quando esta é a instância primária. No
// caminho de lock negado, app.quit() roda sem disparar before-quit/limpeza.
if (gotSingleInstanceLock) {
  app.on('window-all-closed', () => {
    // Don't quit — hide to system tray
  })

  app.on('before-quit', () => {
    // Cancela o timer da otimização automática antes de qualquer limpeza.
    stopRamAutoOptimizer()
    // Qualquer app.quit() (Sair, OS, Playwright) libera o close real da janela.
    markQuitting()
    // Tempo de jogo pendente: flush síncrono no store. Durante a desinstalação
    // destrutiva NÃO grava (o fluxo pode estar apagando o userData; o
    // travamento do app continua intacto).
    if (!isAnyUninstallInProgress()) {
      try {
        flushPlaytimeTracking()
      } catch (err) {
        logger.warn('games', 'Falha ao salvar tempo de jogo na saída:', err)
      }
      // Sessão do registro de uso: duração total + fechamento (uma única vez).
      try {
        endUsageSession()
      } catch (err) {
        logger.warn('usageLog', 'Falha ao fechar a sessão de uso na saída:', err)
      }
    }
    // Aqui a opção mais simples e determinística é o kill SÍNCRONO: o quit do
    // Electron não espera promises e preventDefault + espera assíncrona poderia
    // prender a saída se um filho travasse. taskkill /T /F leva poucos ms e
    // garante que nenhum filho sobreviva ao Hub. O tray já esperou o killAll()
    // normal antes de chamar app.quit(); esta chamada cobre os demais caminhos.
    processManager.killAllSync()
  })

  app.on('will-quit', () => {
    // Para o timer único de processos: nenhuma consulta durante a saída.
    stopProcessWatch()
  })

  app.on('activate', () => {
    // Janela oculta na bandeja → reexibe; sem janela → recria.
    showMainWindow()
  })
}
