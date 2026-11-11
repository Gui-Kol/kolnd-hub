import { app, shell, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron'
import { join, dirname } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { ProcessManager, resolvePath, setBaseDir } from './processManager'
import {
  listStartupItems,
  removeStartupItem,
  addStartupItem,
  removeStartupItemsBatch,
  addStartupItemsBatch,
  getPcName,
  listRunningProcesses
} from './startupManager'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
const processManager = new ProcessManager()

function createWindow(): void {
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
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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
  electronApp.setAppUserModelId('com.kolnd.hub')

  // Relative paths in Settings resolve from the project root in dev and from
  // the installation directory once packaged (never from an inherited cwd).
  setBaseDir(is.dev ? process.cwd() : dirname(app.getPath('exe')))

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // ── IPC: App management ─────────────────────────
  ipcMain.handle('app:launch', async (_event, appId: string, command: string, cwd: string) => {
    return processManager.launch(appId, command, cwd)
  })

  ipcMain.handle('app:stop', async (_event, appId: string) => {
    return processManager.stop(appId)
  })

  ipcMain.handle('app:status', async (_event, appId: string) => {
    return processManager.getStatus(appId)
  })

  ipcMain.handle('app:all-status', async () => {
    return processManager.getAllStatus()
  })

  // ── Sistema ─────────────────────────────────────
  ipcMain.handle('system:pc-name', () => {
    return getPcName()
  })

  ipcMain.handle('system:running-processes', () => {
    return listRunningProcesses()
  })

  // ── Inicialização do PC (startup) ───────────────
  ipcMain.handle('startup:list', () => {
    return listStartupItems()
  })

  ipcMain.handle(
    'startup:remove',
    (_event, item: { location: string; scope: string; name: string }) => {
      return removeStartupItem(item as Parameters<typeof removeStartupItem>[0])
    }
  )

  ipcMain.handle(
    'startup:add',
    (_event, item: { name: string; path: string }) => {
      return addStartupItem(item as Parameters<typeof addStartupItem>[0])
    }
  )

  ipcMain.handle(
    'startup:removeBatch',
    (_event, items: Array<{ location: string; scope: string; name: string }>) => {
      return removeStartupItemsBatch(
        items as Parameters<typeof removeStartupItemsBatch>[0]
      )
    }
  )

  ipcMain.handle(
    'startup:addBatch',
    (_event, items: Array<{ name: string; path: string }>) => {
      return addStartupItemsBatch(items as Parameters<typeof addStartupItemsBatch>[0])
    }
  )

  ipcMain.handle('app:logs', async (_event, appId: string) => {
    return processManager.getLogs(appId)
  })

  // ── IPC: Window controls ────────────────────────
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('window:close', () => mainWindow?.hide())

  // ── IPC: Shell ──────────────────────────────────
  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle('shell:openPath', (_event, path: string) => {
    // Settings may store relative paths (../Kloud Games) or %VAR% paths.
    shell.openPath(resolvePath(path))
  })

  // ── Forward process events to renderer ──────────
  processManager.on('status-change', (appId: string, status: string) => {
    mainWindow?.webContents.send('app:status-changed', appId, status)
  })

  processManager.on('output', (appId: string, data: string) => {
    mainWindow?.webContents.send('app:output', appId, data)
  })

  createWindow()
  createTray()
})

app.on('window-all-closed', () => {
  // Don't quit — hide to system tray
})

app.on('before-quit', () => {
  processManager.killAll()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
