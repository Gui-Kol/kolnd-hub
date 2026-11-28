import { app, Menu, Tray, nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { logger } from '../logger'
import { buildTrayMenuTemplate, type TrayHandlers } from './menu'

/**
 * Contexto da bandeja.
 *
 * `toggleOverlay` é o clique esquerdo no ícone; os demais handlers alimentam
 * o menu de contexto (task 02 preenche o overlay, task 11 as configurações).
 */
export interface TrayContext extends TrayHandlers {
  toggleOverlay: () => void
}

/**
 * Caminho do ícone da bandeja.
 *
 * No app empacotado o arquivo chega como `<resources>/tray-icon.png` via
 * `extraResources` (electron-builder.yml). Em dev fica em `resources/` na raiz
 * do projeto (o `npm run dev` roda com cwd em Absolem/).
 */
export function resolveTrayIconPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'tray-icon.png')
  return join(process.cwd(), 'resources', 'tray-icon.png')
}

/**
 * Carrega o ícone com fallback para imagem vazia. O app nunca deixa de subir
 * por causa de um asset ausente; o log registra o caminho tentado.
 */
export function loadTrayIcon(): NativeImage {
  const iconPath = resolveTrayIconPath()
  if (!existsSync(iconPath)) {
    logger.warn('tray', `ícone da bandeja não encontrado em ${iconPath}; usando imagem vazia`)
    return nativeImage.createEmpty()
  }
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    logger.warn('tray', `ícone da bandeja vazio em ${iconPath}; usando imagem vazia`)
    return nativeImage.createEmpty()
  }
  return icon
}

/**
 * Cria a bandeja: ícone (packaged vs dev), tooltip, menu de contexto e clique
 * esquerdo alternando o overlay. O chamador deve guardar a referência viva.
 */
export function createTray(ctx: TrayContext): Tray {
  const tray = new Tray(loadTrayIcon())
  tray.setToolTip('Absolem')
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(ctx)))
  tray.on('click', () => {
    ctx.toggleOverlay()
  })
  return tray
}
