import { app, crashReporter } from 'electron'
import { logger } from './logger'

/**
 * Crash reporting LOCAL do processo main (task 06-6.2).
 *
 * NADA sai desta máquina: `uploadToServer: false` inequívoco e NENHUMA URL de
 * envio configurada em lugar nenhum. Não há Sentry, endpoint próprio nem
 * telemetria — qualquer variante com envio remoto exigiria nova decisão
 * explícita do usuário. Com `uploadToServer: false` os minidumps continuam
 * gravados em disco local, mas nunca são enviados a ninguém.
 *
 * Achado T1 (API confirmada em electron@^28.3.3, node_modules/electron/electron.d.ts):
 * - `crashReporter.start(options: CrashReporterStartOptions): void` — deve ser
 *   chamado no main o mais cedo possível, antes de `app.whenReady()`.
 * - NÃO existe opção `crashesDirectory` em CrashReporterStartOptions. As únicas
 *   opções são: submitURL (opcional; "Required unless uploadToServer is false"),
 *   productName, companyName (deprecada), uploadToServer (default TRUE!),
 *   ignoreSystemCrashHandler, rateLimit, compress (default true), extra e
 *   globalExtra.
 * - O diretório efetivo dos minidumps é `app.getPath('crashDumps')`, que por
 *   padrão resolve para `<userData>/Crashpad` → neste app,
 *   `%APPDATA%\kolnd-hub\Crashpad` (confirmado no source do Electron,
 *   shell/common/electron_paths.cc: DIR_CRASH_DUMPS = userData + "Crashpad").
 *   O layout interno do diretório é detalhe de implementação do Crashpad e
 *   pode mudar entre versões.
 * - O Electron documenta a relocação via `app.setPath('crashDumps', dir)` (o
 *   diretório precisa existir — mkdirSync antes) chamado ANTES de
 *   crashReporter.start(). Não utilizado aqui: a tarefa 06-6.2 optou por manter
 *   o caminho padrão e registrar o efetivo no log; ver relatório/tarefa 6.3.
 */

/** Caminho efetivo dos minidumps (para log/diagnóstico). Nunca lança. */
function resolveCrashesDir(): string | null {
  try {
    return app.getPath('crashDumps')
  } catch {
    return null
  }
}

/** Inicia o crashReporter local. Nunca derruba o app por falha na inicialização. */
export function startCrashReporting(): void {
  try {
    // Sem upload: minidumps ficam no disco local e nada é transmitido.
    crashReporter.start({ uploadToServer: false, submitURL: '', compress: true })
    const dir = resolveCrashesDir()
    logger.info(
      'crash',
      `crashReporter iniciado (uploadToServer: false; nada é enviado) — minidumps locais em: ${
        dir ?? 'caminho indisponível'
      }`
    )
  } catch (err) {
    logger.error('crash', 'Falha ao iniciar o crashReporter local', err)
  }
}

/**
 * Hook registrável de limpeza dos processos filhos. Fica aqui (e não importando
 * o processManager) porque este módulo é o PRIMEIRO import do index.ts: evitar
 * dependência pesada/ciclo mantém o crashReporter iniciando antes de tudo.
 */
let childProcessCleanup: (() => void) | null = null

/** Registra a limpeza síncrona dos filhos (index.ts injeta processManager.killAllSync). */
export function registerChildProcessCleanup(fn: () => void): void {
  childProcessCleanup = fn
}

/**
 * Exceção não capturada no processo main: loga [CRASH] com o stack completo,
 * mata os processos filhos (senão eles ficam órfãos e o relançamento cria uma
 * segunda instância fora do rastreamento do Hub) e ENCERRA com código 1 — o Hub
 * nunca continua rodando em estado indeterminado. (appendFileSync do logger é
 * síncrono, o rastro vai a disco antes da saída.)
 */
export function handleUncaughtException(err: unknown): void {
  logger.error('crash', '[CRASH] Exceção não capturada — encerrando o processo com código 1', err)
  try {
    // Falha na limpeza não pode impedir a saída: só registra e segue para exit(1).
    childProcessCleanup?.()
  } catch (cleanupErr) {
    logger.error('crash', 'Falha ao matar processos filhos antes da saída', cleanupErr)
  }
  app.exit(1)
}

/** Rejeição não tratada: loga [unhandledRejection] com o stack e CONTINUA o processo. */
export function handleUnhandledRejection(reason: unknown): void {
  logger.error('crash', '[unhandledRejection] Rejeição não tratada (o processo continua)', reason)
}

/** Registra os handlers de processo e de processos-filho (renderers/GPU/etc.). */
export function installCrashHandlers(): void {
  process.on('uncaughtException', handleUncaughtException)
  process.on('unhandledRejection', handleUnhandledRejection)

  // Opcional (escopo local, barato): renderers/filhos que morrem ficam no log.
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

// Execução no topo do módulo, de propósito: este arquivo é o PRIMEIRO import de
// index.ts, então crashReporter.start() roda no module scope, antes de
// app.whenReady() e antes da avaliação de qualquer import que possa lançar.
startCrashReporting()
installCrashHandlers()
