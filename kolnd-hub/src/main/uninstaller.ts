import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { EventEmitter } from 'events'
import { execFileSync, spawn } from 'child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import {
  detectKloudGames,
  findHubUninstaller,
  mapMsiexecExitCode,
  type KloudGamesDetection,
  type MsiexecExitCodeResult
} from './uninstallDetection'
import { verifyKloudGamesRemoval, type KloudGamesUninstallReport } from './uninstallVerify'
import {
  findKloudGamesExe,
  findKloudGamesMsi,
  getKloudGamesUninstallLogPath,
  isKloudGamesRunning,
  looksLikeUacDenied,
  resetKloudGamesState,
  appendKloudGamesUninstallLog
} from './kloudGames'

export interface UninstallProgress {
  stepId: string
  status: 'running' | 'done' | 'error'
  progress: number
  message?: string
}

export type UninstallLogLine = string

export interface UninstallReport {
  success: boolean
  cancelled: boolean
  needsReboot: boolean
  remaining: string[]
  logPath: string
  /** Laudo pós-desinstalação do Kloud Games (T3). */
  report?: KloudGamesUninstallReport
  error?: string
}

const KLOUD_PROCESS_NAME = 'KLOUD_GAMES.exe'
const KLOUD_TEMP_DIR_NAME = 'KLOUD_GAMES'

/** Resultado da execução elevada de um comando PowerShell. */
interface ElevatedResult {
  exitCode: number | null
  output: string
}

/**
 * Fluxo de desinstalação do Kloud Games: verificação (registro/serviço/exe) →
 * encerramento opcional do processo → msiexec /x elevado → verificação → limpeza
 * de temporários. Emite eventos de progresso/log/complete para o renderer.
 *
 * Todas as leituras de registro/serviço reusam a camada pura de T1
 * (`uninstallDetection.ts`); a remoção do MSI é sempre feita pelo instalador
 * oficial (`msiexec /x {ProductCode}`), nunca apagando arquivos na mão.
 */
export class Uninstaller extends EventEmitter {
  private isUninstalling = false

  isBusy(): boolean {
    return this.isUninstalling
  }

  /**
   * Executa a desinstalação do Kloud Games. `emit` recebe cada evento de
   * progresso (usado em testes e chamadas diretas); o mesmo evento também é
   * emitido via `this.emit` para que o IPC reencaminhe ao renderer.
   */
  async uninstall(emit: (evt: UninstallProgress) => void): Promise<UninstallReport> {
    if (this.isUninstalling) {
      throw new Error('Desinstalação já em andamento')
    }

    this.isUninstalling = true
    const logPath = getKloudGamesUninstallLogPath()
    const report: UninstallReport = {
      success: false,
      cancelled: false,
      needsReboot: false,
      remaining: [],
      logPath
    }

    const progress = (stepId: UninstallProgress['stepId'], status: UninstallProgress['status'], progress: number, message?: string): void => {
      const evt: UninstallProgress = { stepId, status, progress, message }
      emit(evt)
      this.emit('progress', evt)
    }

    const log = (line: string): void => {
      this.emit('log', line)
    }

    try {
      // ── Etapa check (5) ────────────────────────────────────────────
      progress('check', 'running', 5, 'Verificando instalação…')
      log('[check] Verificando instalação do Kloud Games…\n')

      const detection = detectKloudGames()

      if (detection.status === 'missing') {
        progress('check', 'done', 100, 'Não instalado — nada a remover.')
        log('[check] Kloud Games não está instalado (sem exe, sem registro, sem serviço) — idempotente.\n')
        report.success = false
        report.error = 'O Kloud Games não está instalado.'
        return report
      }

      if (detection.entry?.productCode == null && detection.exePath == null) {
        progress('check', 'error', 0, 'Desinstalação pelo registro não encontrada.')
        log('[check] Sem productCode do registro e sem exe: não é possível desinstalar via msiexec.\n')
        report.success = false
        report.error = 'Desinstalação pelo registro não encontrada — use Configurações do Windows → Aplicativos.'
        return report
      }

      progress('check', 'done', 100, 'Instalação verificada.')
      log('[check] Instalação do Kloud Games verificada.\n')

      // ── Etapa kill (15) — só quando o processo está rodando ────────
      if (isKloudGamesRunning()) {
        progress('kill', 'running', 15, 'Encerrando Kloud Games…')
        log('[kill] Kloud Games está em execução; encerrando processo…\n')

        let killed = false
        try {
          execFileSync('taskkill', ['/IM', KLOUD_PROCESS_NAME, '/F'], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 15000
          })
          killed = true
        } catch {
          // acesso negado → tenta elevado via PowerShell
          try {
            execFileSync(
              'powershell.exe',
              ['-NoProfile', '-Command', `Start-Process taskkill -Verb RunAs -ArgumentList '/IM','${KLOUD_PROCESS_NAME}','/F' -Wait`],
              { encoding: 'utf8', windowsHide: true, timeout: 30000 }
            )
            killed = true
          } catch {
            killed = false
          }
        }

        if (!killed) {
          progress('kill', 'error', 0, 'Feche o Kloud Games manualmente e tente de novo.')
          log('[kill] Não foi possível encerrar o KLOUD_GAMES.exe (sem permissão). Abortando antes do msiexec.\n')
          report.success = false
          report.error = 'Feche o Kloud Games manualmente e tente de novo.'
          return report
        }

        progress('kill', 'done', 100, 'Kloud Games encerrado.')
        log('[kill] KLOUD_GAMES.exe encerrado.\n')
      }

      // ── Etapa msiexec (25 → 80) ────────────────────────────────────
      const productCode = detection.entry?.productCode
      if (!productCode) {
        progress('msiexec', 'error', 0, 'ProductCode do Kloud Games não localizado.')
        log('[msiexec] Sem productCode — não é possível executar msiexec /x.\n')
        report.success = false
        report.error = 'ProductCode do Kloud Games não localizado.'
        return report
      }

      progress('msiexec', 'running', 25, 'Desinstalando o Kloud Games…')
      log('[msiexec] Iniciando desinstalação elevada do MSI (msiexec /x)…\n')

      const escapedGuid = productCode.replace(/'/g, "''")
      const command = `$p = Start-Process msiexec.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '/x','"${escapedGuid}"','/qn','/norestart'; exit $p.ExitCode`

      appendKloudGamesUninstallLog(
        `Início da desinstalação do Kloud Games\nProductCode: ${productCode}\nComando: powershell.exe -NoProfile -Command ${command}`
      )

      const elevated = await runElevatedPowerShell(command)

      appendKloudGamesUninstallLog(
        `Código de saída do processo elevado: ${elevated.exitCode ?? 'desconhecido'}\nSaída:\n${elevated.output.trim() || '(sem saída)'}`
      )

      let msiexecResult: MsiexecExitCodeResult = mapMsiexecExitCode(elevated.exitCode)
      if (looksLikeUacDenied(elevated.output)) {
        msiexecResult = mapMsiexecExitCode(1223)
      }

      switch (msiexecResult.kind) {
        case 'success':
          report.success = true
          log(`[msiexec] ${msiexecResult.message}\n`)
          break
        case 'needs-reboot':
          report.success = true
          report.needsReboot = true
          log(`[msiexec] ${msiexecResult.message}\n`)
          break
        case 'cancelled':
          report.success = false
          report.cancelled = true
          report.error = msiexecResult.message
          log(`[msiexec] ${msiexecResult.message}\n`)
          return report
        case 'uac-denied':
          report.success = false
          report.cancelled = true
          report.error = msiexecResult.message
          log(`[msiexec] ${msiexecResult.message}\n`)
          return report
        case 'already-absent':
          report.success = true
          log(`[msiexec] ${msiexecResult.message}\n`)
          break
        case 'newer-version':
          // Sucesso parcial: já existe versão mais nova; nada removido, mas não é erro do Hub.
          report.success = true
          report.remaining.push(msiexecResult.message)
          log(`[msiexec] ${msiexecResult.message}\n`)
          break
        case 'other-install':
        case 'policy-blocked':
        case 'fatal':
        case 'unknown':
        default:
          report.success = false
          report.error = msiexecResult.message
          log(`[msiexec] ${msiexecResult.message}\n`)
          return report
      }

      progress('msiexec', 'done', 80, 'Remoção do MSI concluída.')
      log('[msiexec] Remoção do MSI concluída.\n')

      // ── Etapa verify (85) — mínimo inline (T3 trará o laudo completo) ─
      progress('verify', 'running', 85, 'Verificando a remoção…')
      log('[verify] Zerando estado salvo e verificando remoção…\n')
      resetKloudGamesState()
      const exeStillExists = findKloudGamesExe() !== null
      if (exeStillExists) {
        report.remaining.push('O executável KLOUD_GAMES.exe ainda foi detectado após a desinstalação.')
      }
      progress('verify', 'done', 100, 'Verificação concluída.')
      log('[verify] Verificação concluída.\n')

      // ── Etapa cleanup (95) ─────────────────────────────────────────
      progress('cleanup', 'running', 95, 'Limpando dados temporários…')
      log('[cleanup] Limpando %TEMP%\\KLOUD_GAMES…\n')
      resetKloudGamesState()
      removeTempKloudGamesDir()

      // ── T3: laudo pós-desinstalação ────────────────────────────────
      const verify = verifyKloudGamesRemoval()
      report.remaining = verify.remaining
      report.report = verify
      // Sucesso real: exe, serviço e registro do Kloud Games sumiram.
      // Atalhos e %TEMP% são apenas avisos (não impedem o sucesso).
      report.success = verify.exeGone && verify.serviceGone && verify.registryGone
      if (verify.remaining.length > 0) {
        log(`[cleanup] Laudo de remoção (remanescentes): ${verify.remaining.join('; ')}\n`)
      } else {
        log('[cleanup] Laudo de remoção: sem remanescentes.\n')
      }

      progress('cleanup', 'done', 100, 'Limpeza concluída.')
      log('[cleanup] Limpeza concluída.\n')

      // ── done ───────────────────────────────────────────────────────
      progress('done', 'done', 100, 'Concluído')
      log('[done] Desinstalação do Kloud Games finalizada.\n')
      this.emit('complete', report)
      return report
    } finally {
      this.isUninstalling = false
    }
  }
}

/** Instância única reutilizada pelo IPC (guarda de reentrância compartilhada). */
export const uninstaller = new Uninstaller()

/**
 * Função de conveniência com a assinatura exigida pela T2.
 * Reencaminha eventos de progresso via `emit` e roda a instância compartilhada.
 */
export async function uninstallKloudGames(
  emit: (evt: UninstallProgress) => void
): Promise<UninstallReport> {
  return uninstaller.uninstall(emit)
}

/** Reexporta a tabela pura de códigos do msiexec (T1) para uso/testes da T2/T6. */
export { mapMsiexecExitCode }
export type { MsiexecExitCodeResult }

/** Executa um comando PowerShell elevado capturando saída e código de saída. */
function runElevatedPowerShell(command: string): Promise<ElevatedResult> {
  return new Promise((resolve) => {
    let output = ''
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    child.stdout?.on('data', (chunk: Buffer | string) => {
      output += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      output += chunk.toString()
    })

    child.on('close', (code: number | null) => {
      resolve({ exitCode: code ?? null, output })
    })

    child.on('error', (err: Error) => {
      resolve({ exitCode: null, output: `Falha ao iniciar o processo elevado: ${err.message}` })
    })
  })
}

/** Remove %TEMP%\KLOUD_GAMES de forma tolerante (é TEMP; nunca aborta o fluxo). */
function removeTempKloudGamesDir(): void {
  try {
    const temp = process.env.TEMP || process.env.TMP || ''
    if (!temp) return
    const dir = join(temp, KLOUD_TEMP_DIR_NAME)
    if (!existsSync(dir)) return
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Silencioso: falha na limpeza de TEMP não impede a desinstalação.
  }
}

/**
 * Registra os canais IPC de desinstalação do Kloud Games (e disponibilidade do
 * desinstalador do Hub). O fluxo completo "Desinstalar Kolnd Hub" (`uninstall:hub`)
 * fica para a T5.
 */
export function registerUninstallIpc(getWindow: () => BrowserWindow | null): void {
  // Reencaminha eventos do Uninstaller para o renderer.
  uninstaller.on('progress', (data: UninstallProgress) => {
    getWindow()?.webContents.send('uninstall:progress', data)
  })

  uninstaller.on('log', (line: UninstallLogLine) => {
    getWindow()?.webContents.send('uninstall:log', line)
  })

  uninstaller.on('complete', (result: UninstallReport) => {
    getWindow()?.webContents.send('uninstall:complete', result)
  })

  // ── Status do Kloud Games (síncrono) ───────────────────────────────
  ipcMain.handle('uninstall:kloud-status', () => {
    try {
      const detection: KloudGamesDetection = detectKloudGames()
      return { ok: true, detection }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // ── Inicia a desinstalação do Kloud Games (retorna imediatamente) ────
  ipcMain.handle('uninstall:kloud-games', async () => {
    if (uninstaller.isBusy()) {
      return {
        success: false,
        error: 'Desinstalação já em andamento. Aguarde o término e tente de novo.'
      }
    }

    void uninstaller
      .uninstall((evt: UninstallProgress) => {
        // Também reencaminhado via this.emit acima; mantido para compatibilidade.
        getWindow()?.webContents.send('uninstall:progress', evt)
      })
      .then((report: UninstallReport) => {
        // 'complete' já é reencaminhado pelo listener do EventEmitter.
        void report
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        getWindow()?.webContents.send('uninstall:log', `[uninstall] Erro inesperado: ${message}\n`)
        getWindow()?.webContents.send('uninstall:complete', { success: false, error: message })
      })

    return { success: true }
  })

  // ── Disponibilidade do desinstalador do Kolnd Hub (T1) ───────────────
  ipcMain.handle('uninstall:hub-status', () => {
    const detection = findHubUninstaller()
    return {
      available: detection.available,
      uninstallerPath: detection.uninstallerPath,
      isPackaged: app.isPackaged
    }
  })

  // ── Backup opcional de %APPDATA%\kolnd-hub ───────────────────────────
  ipcMain.handle('uninstall:backup-data', () => {
    try {
      const source = join(app.getPath('appData'), 'kolnd-hub')
      if (!existsSync(source)) {
        return {
          success: false,
          error: 'A pasta %APPDATA%\\kolnd-hub não existe — nada para fazer backup.'
        }
      }

      const documents = app.getPath('documents')
      const now = new Date()
      const stamp = now
        .toISOString()
        .slice(0, 19)
        .replace(/[-:]/g, '')
        .replace('T', '-') // AAAAMMDD-HHmmss
      const baseName = `KolndHub-Backup-${stamp}`

      // Nunca sobrescreve um backup existente: adiciona -2, -3, …
      let target = join(documents, baseName)
      let suffix = 2
      while (existsSync(target)) {
        target = join(documents, `${baseName}-${suffix}`)
        suffix += 1
      }

      mkdirSync(documents, { recursive: true })
      cpSync(source, target, { recursive: true })

      return { success: true, path: target }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Não foi possível fazer o backup dos dados do Hub.'
      }
    }
  })

  // ── Abre a pasta de logs do Kolnd Hub ────────────────────────────────
  ipcMain.handle('uninstall:open-logs', () => {
    const logDir = dirname(getKloudGamesUninstallLogPath())
    void shell.openPath(logDir)
  })
}
