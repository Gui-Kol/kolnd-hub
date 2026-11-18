/**
 * Decisão de notificar a queda de um processo gerenciado (07-7.2).
 *
 * Função pura extraída para teste — o disparo em si (Notification do Electron)
 * fica em `ipc/processEvents.ts`. Três guards, todos obrigatórios:
 * - `status === 'error'`: paradas voluntárias (stop()/killAll()/shutdown)
 *   viram `'stopped'`, então só quedas reais chegam aqui;
 * - `notifyOnCrash`: preferência do usuário (opt-out, default true);
 * - `uninstallInProgress`: nunca notificar no meio de uma desinstalação
 *   destrutiva (`isAnyUninstallInProgress()`).
 */
export function shouldNotifyOnCrash(
  status: string,
  notifyOnCrash: boolean,
  uninstallInProgress: boolean
): boolean {
  return status === 'error' && notifyOnCrash === true && uninstallInProgress === false
}

/** Corpo do toast (pt-BR) a partir do nome amigável do app. */
export function crashNotificationBody(appLabel: string): string {
  return `${appLabel} parou inesperadamente — clique para reabrir.`
}

/**
 * Resolve o nome amigável do app a partir da config persistida.
 * Fallback: o próprio `appId` (config ausente/ilegível nunca derruba o fluxo).
 */
export function resolveCrashNotificationLabel(
  apps: ReadonlyArray<{ id: string; name: string }> | null | undefined,
  appId: string
): string {
  const name = apps?.find((a) => a.id === appId)?.name?.trim()
  return name ? name : appId
}
