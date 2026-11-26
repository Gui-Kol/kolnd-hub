import { app, crashReporter } from 'electron'
import { logger } from './logger'

/**
 * Crash reporting LOCAL do processo main.
 *
 * Nada sai da máquina: `uploadToServer: false` e nenhuma URL de envio. Os
 * minidumps ficam em `app.getPath('crashDumps')` (por padrão `userData/Crashpad`)
 * e nunca são transmitidos. Qualquer envio remoto futura exigiria decisão
 * explícita do usuário.
 *
 * Este módulo é o PRIMEIRO import de `index.ts`: `crashReporter.start()` roda no
 * module scope, antes de `app.whenReady()` e antes de qualquer import que possa
 * lançar.
 */

/** Caminho efetivo dos minidumps (para log). Nunca lança. */
function resolveCrashesDir(): string | null {
  try {
    return app.getPath('crashDumps')
  } catch {
    return null
  }
}

/** Inicia o crashReporter local. Falha na inicialização nunca derruba o app. */
export function startCrashReporting(): void {
  try {
    crashReporter.start({ uploadToServer: false, submitURL: '', compress: true })
    const dir = resolveCrashesDir()
    logger.info(
      'crash',
      `crashReporter iniciado (uploadToServer: false; nada é enviado) - minidumps locais em: ${
        dir ?? 'caminho indisponível'
      }`
    )
  } catch (err) {
    logger.error('crash', 'Falha ao iniciar o crashReporter local', err)
  }
}

/**
 * Exceção não capturada no main: loga `[CRASH]` com o stack e encerra com
 * código 1. O `appendFileSync` do logger é síncrono, então o rastro chega ao
 * disco antes da saída.
 */
export function handleUncaughtException(err: unknown): void {
  logger.error('crash', '[CRASH] Exceção não capturada - encerrando com código 1', err)
  app.exit(1)
}

/** Rejeição não tratada: loga e CONTINUA o processo. */
export function handleUnhandledRejection(reason: unknown): void {
  logger.error('crash', '[unhandledRejection] Rejeição não tratada (o processo continua)', reason)
}

/** Registra handlers de processo e de processos-filho (renderer, GPU, utilitários). */
export function installCrashHandlers(): void {
  process.on('uncaughtException', handleUncaughtException)
  process.on('unhandledRejection', handleUnhandledRejection)

  app.on('render-process-gone', (_event, _webContents, details) => {
    logger.error(
      'crash',
      `render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`
    )
  })

  app.on('child-process-gone', (_event, details) => {
    const service = details.serviceName ?? details.name
    logger.error(
      'crash',
      `child-process-gone: type=${details.type} reason=${details.reason} exitCode=${
        details.exitCode
      }${service ? ` service=${service}` : ''}`
    )
  })
}

// Efeitos colaterais intencionais no topo do módulo: index.ts importa este
// arquivo primeiro, antes de qualquer outro módulo do main.
startCrashReporting()
installCrashHandlers()
