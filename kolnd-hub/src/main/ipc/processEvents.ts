import { Notification } from 'electron'
import type { IpcContext } from './lifecycle'
import { getConfigSnapshot, getNotifyOnCrash } from '../store'
import { isAnyUninstallInProgress } from '../uninstaller'
import { logger } from '../logger'
import {
  crashNotificationBody,
  resolveCrashNotificationLabel,
  shouldNotifyOnCrash
} from '../notifyOnCrash'
import { appendUsageEvent, buildUsageEvent } from '../usageLog'

/**
 * Último status visto por app — evita toast duplicado quando a queda emite
 * `'error'` duas vezes para a mesma falha (child `'error'` + `'close'`).
 * Qualquer status não-error zera a marca, então um novo crash notifica de novo.
 */
const lastStatusByApp = new Map<string, string>()

/**
 * Reencaminha os eventos do ProcessManager para o renderer:
 * `status-change` → `app:status-changed`, `output` → `app:output`.
 *
 * Em `status-change → 'error'` (queda inesperada, nunca parada voluntária),
 * exibe também uma notificação nativa do Windows (07-7.2), a menos que o
 * usuário tenha desligado a pref `notifyOnCrash` ou haja uma desinstalação
 * em andamento. Clique na notificação → foca a janela do Hub.
 */
export function registerProcessEvents(ctx: IpcContext): void {
  ctx.processManager.on('status-change', (appId: string, status: string) => {
    ctx.getMainWindow()?.webContents.send('app:status-changed', appId, status)

    const lastStatus = lastStatusByApp.get(appId)
    lastStatusByApp.set(appId, status)

    // Registro de uso: só a TRANSIÇÃO para em execução/parado gera evento
    // (um `error` repetido da mesma queda não vira dois `app-stop`).
    if (status === 'running' && lastStatus !== 'running') {
      const name = resolveCrashNotificationLabel(getConfigSnapshot().apps, appId)
      appendUsageEvent(buildUsageEvent('app-launch', { appId, name }))
    } else if (
      (status === 'stopped' || status === 'error') &&
      lastStatus !== 'stopped' &&
      lastStatus !== 'error'
    ) {
      const name = resolveCrashNotificationLabel(getConfigSnapshot().apps, appId)
      appendUsageEvent(buildUsageEvent('app-stop', { appId, name }))
    }

    if (lastStatus === 'error' && status === 'error') return // mesma queda reemitida — sem spam
    if (!shouldNotifyOnCrash(status, getNotifyOnCrash(), isAnyUninstallInProgress())) return

    try {
      const label = resolveCrashNotificationLabel(getConfigSnapshot().apps, appId)
      const notification = new Notification({
        title: 'Kolnd Hub',
        body: crashNotificationBody(label)
      })
      notification.on('click', () => {
        const win = ctx.getMainWindow()
        win?.show()
        win?.focus()
      })
      notification.show()
      logger.info('processEvents', `Notificação de queda exibida (appId=${appId})`)
    } catch (err) {
      // Toast é best-effort: falha nunca derruba o forward nem o app.
      logger.warn('processEvents', `Falha ao exibir notificação de queda (appId=${appId}):`, err)
    }
  })

  ctx.processManager.on('output', (appId: string, data: string) => {
    ctx.getMainWindow()?.webContents.send('app:output', appId, data)
  })
}
