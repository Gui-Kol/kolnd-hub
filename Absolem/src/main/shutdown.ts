import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { logger } from './logger'
import { markQuitting } from './quitState'

/** Motivo do encerramento registrado no log de ciclo de vida. */
export type ShutdownReason = 'tray' | 'relaunch' | 'os-session-end' | 'crash'

/** Contexto mínimo do encerramento: as janelas são lidas por getter. */
export interface ShutdownContext {
  getMainWindow: () => BrowserWindow | null
  getOverlayWindow: () => BrowserWindow | null
}

type ShutdownHook = () => void

interface RegisteredHook {
  name: string
  run: ShutdownHook
}

const hooks: RegisteredHook[] = []

/**
 * Registra um gancho best-effort do encerramento. A task 02 usa para pedir ao
 * controlador do overlay que destrua a janela; a task 06, para encerrar a
 * sessão de voz. Um gancho que lança não impede os demais nem o `app.quit()`.
 */
export function registerShutdownHook(name: string, run: ShutdownHook): void {
  hooks.push({ name, run })
}

/** Hook exclusivo de teste: esvazia o registro entre casos. */
export function resetShutdownHooksForTests(): void {
  hooks.length = 0
}

function runHooks(): void {
  for (const hook of hooks) {
    try {
      hook.run()
      logger.info('lifecycle', `gancho de encerramento concluído: ${hook.name}`)
    } catch (err) {
      logger.warn('lifecycle', `gancho de encerramento falhou: ${hook.name}`, err)
    }
  }
}

function destroyWindow(label: string, getWindow: () => BrowserWindow | null): void {
  try {
    const window = getWindow()
    if (window && !window.isDestroyed()) {
      window.destroy()
      logger.info('lifecycle', `janela ${label} destruída para o encerramento`)
    }
  } catch (err) {
    logger.warn('lifecycle', `falha ao destruir a janela ${label} no encerramento`, err)
  }
}

/**
 * Caminho único de encerramento explícito.
 *
 * Marca `isQuitting` ANTES de qualquer `app.quit()`: sem isso o handler de
 * `close` da janela intercepta a saída e o processo fica preso. Os ganchos e a
 * destruição das janelas são best-effort e logados; uma falha não impede a
 * saída. O electron-store grava de forma síncrona a cada `set`, então não há
 * estado pendente a persistir nesta fase - quando houver, ele entra como um
 * gancho registrado.
 */
export function shutdownApp(ctx: ShutdownContext, reason: ShutdownReason = 'tray'): void {
  markQuitting()
  logger.info('lifecycle', `encerrando (motivo: ${reason})`)
  runHooks()
  destroyWindow('overlay', ctx.getOverlayWindow)
  destroyWindow('main', ctx.getMainWindow)
  app.quit()
}
