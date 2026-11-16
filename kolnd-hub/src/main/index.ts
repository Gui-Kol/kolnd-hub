// PRIMEIRO import: efeito colateral intencional — inicia o crashReporter local
// (uploadToServer: false) e registra os handlers de crash ANTES de qualquer
// outro módulo do main ser avaliado (ver src/main/crashReporting.ts).
import './crashReporting'
import { app, shell, BrowserWindow, Tray, Menu, nativeImage } from 'electron'
import { join, dirname } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { ProcessManager, setBaseDir } from './processManager'
import { isFirstRun } from './firstRun'
import { registerSystemIpc } from './ipc/system'
import { registerStartupIpc } from './ipc/startup'
import { registerFirstRunIpc as registerFirstRunStatusIpc } from './ipc/firstRun'
import { registerFirstRunIpc as registerFirstRunInstallerIpc } from './firstRunInstaller'
import { registerConfigIpc, registerPrefsIpc, getConfigSnapshot } from './store'
import { registerGamepadIpc } from './gamepad'
import { registerWingetIpc } from './wingetUpdater'
import { registerTempCleanerIpc } from './tempCleaner'
import { registerUninstallIpc, isAnyUninstallInProgress } from './uninstaller'
import { registerGamesIpc } from './games'
import { registerCommandValidateIpc } from './commandValidate'
import { registerSteamIpc } from './steamScanner'
import { seedMarkLviData } from './programsDeployer'
import { registerShellIpc, isAllowedExternalUrl } from './ipc/shell'
import { registerDialogIpc } from './ipc/dialog'
import { registerWindowIpc } from './ipc/window'
import { registerAppIpc } from './ipc/app'
import { registerKloudGamesIpc } from './ipc/kloudGames'
import { registerUninstallHubIpc } from './ipc/uninstall'
import { registerProcessEvents } from './ipc/processEvents'
import { registerDiagnosticIpc } from './ipc/diagnostic'
import { confirmAndQuit } from './ipc/lifecycle'
import type { IpcContext } from './ipc/lifecycle'
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

function createWindow(isFirstRunMode = false): void {
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
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
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

function createTray(): void {
  // 32x32 lightning icon (generated from resources/icon.png)
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAM+SURBVFhHvddLTxNRFAfwLln6EVy6ZOnSJV8AUCidaTutWEBAIIA8WrBY6gNFAgUEeWiigqELTWpiVAQfiQESWeACEkQT42PRdu6dmb6PnukD24S2dxo8ydnO7z+3Z85Mdbo8ZRP85Y1CkG8yBx3YzaluVZs42ozJ7jASR2equ1Pdg80RRy8X5O0cLc+99pFltYqnbELQ2yCI0CiI0CSIcFEQodksQotZhFazCJfMBNpMBNpNBDpMBDpNBLqMBLqNBC4bCfQYCfTyBPp4Av08ATtPwcFRGDAQn50Lns41M3Ve8PM2S1A5FpyjMMhRcHIUrhokl52DsizcKgTqbRYRjhsfMmAACi4D9RzieOwl3vmkU2bBYbiOgquWnFED2Czi61Jwu5XAzmaUCXfXUbimp/s6joOyUnA89o+vImoARhyu6yno6oXg6VLw2WEZsNaehZnxG3oJdA1CsEUr7rRRIIGEGmDZE2LGb9ZKoMMFowXHgdtaj6g41sygzIyPpANowZc8SgbHcl+QmPFbGABXKyvubqagSMmjx8KfQQt+Ox2ABcdHbXc7lnX3e9sxTfhojQQ6fLGw4E8XQlk41o+DOKx5I7Ce6rcryX63EoEHDvlI/E4yAHEUi4+0SxA9nLuCFfidgDGrfCQ+hgHwdVoMjkvm214818hbj4dCefHxGjkZoBj8xXI49/p56/1KpCA+cU4GnfoxUQD39MtMR/99Nw6jfGHcgwHwKyYfjuv1yUQIVr0ReOONqMOWHriDz9lPAxYGnetQisIn0wHy4fnW69bLaK4Pz6fCReNTGAC/37Tg+Jz/PMgeyt2NGBM+fTYVQAuOS+bfuaCBBIxbZCb8LgbAr1ct+HxP8jWcriVniBmfUQNwxMGK43r1TR1uxE1fVBM+iwH6OLGLFcfdvuFLDuCvL3EY47Xh96rVEwhUsOK427/uxNQZWOhQNONzGMDO+U+w4rjhQlICVu+HS8LnMQDWgIHus+AzLTLsf4qVjC9WyYoa4ApHK4rF8Tl/ZFdg2iaXhlcrsFApd2X+nAwZpLlicK3TnosvViofMjgWzoLLQHz/C39YrZzMCpAul57y7lrqPxa8Slayjv1v/QHnqTkMuvP76QAAAABJRU5ErkJggg==',
      'base64'
    )
  )

  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Kolnd Hub',
      click: (): void => {
        mainWindow?.show()
        mainWindow?.focus()
      }
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: (): void => {
        // Durante uma desinstalação destrutiva, o tray não encerra o app
        // (nem mata processos no meio do msiexec/wipe).
        if (isAnyUninstallInProgress()) return
        processManager.killAll()
        app.quit()
      }
    }
  ])

  tray.setToolTip('Kolnd Hub')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    mainWindow?.show()
    mainWindow?.focus()
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

  // Registra os canais IPC do modo Big Picture (controle + preferências de sons).
  registerGamepadIpc()

  // Registra os canais IPC do winget (listagem de atualizações).
  registerWingetIpc()

  // Registra os canais IPC da limpeza de arquivos temporários.
  registerTempCleanerIpc()

  // Registra os canais IPC da biblioteca de jogos.
  registerGamesIpc()

  // Registra os canais IPC da importação de jogos da Steam.
  registerSteamIpc()

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

  // Registra o canal IPC de desinstalação do próprio Hub (uninstall:hub).
  registerUninstallHubIpc(ctx)

  // Reencaminha os eventos do ProcessManager para o renderer (status/output).
  registerProcessEvents(ctx)

  // Registra o canal IPC de exportação de diagnóstico (diagnostic:export).
  registerDiagnosticIpc(ctx)

  // Registra os canais IPC de desinstalação (Kloud Games via msiexec + status do Hub).
  registerUninstallIpc(() => mainWindow)

  // Seed dos dados do Mark LVI para %APPDATA%/kolnd-hub/mark-lvi
  // (migração transparente para quem já tinha config/memory ao lado do exe).
  seedMarkLviData()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Intercepta o evento de fechamento da janela (X do SO, Alt+F4, etc.) para
  // também exibir o popup de confirmação em vez de apenas esconder a janela.
  mainWindow?.on('close', (event) => {
    event.preventDefault()
    // Alt+F4 / X do title bar durante passos destrutivos: inerte (sem diálogo).
    if (isAnyUninstallInProgress()) {
      return
    }
    void confirmAndQuit(ctx)
  })

  const firstRun = isFirstRun()
  createWindow(firstRun)
  createTray()
})

// Handlers de ciclo de vida: só quando esta é a instância primária. No
// caminho de lock negado, app.quit() roda sem disparar before-quit/limpeza.
if (gotSingleInstanceLock) {
  app.on('window-all-closed', () => {
    // Don't quit — hide to system tray
  })

  app.on('before-quit', () => {
    processManager.killAll()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}
