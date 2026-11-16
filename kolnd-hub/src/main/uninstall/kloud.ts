/**
 * Domínio Kloud Games da desinstalação (T3 do split de uninstaller.ts):
 * consts/mensagens, verificações puras, `deleteKloudGamesOrphanFolder`,
 * fluxo `Uninstaller` (check → kill → msiexec → verify → cleanup), remoção
 * manual parcial (órfãos) e remoção elevada do serviço KLOUD_GAMESsvc.
 *
 * O singleton `uninstaller` vive AQUI (criado uma única vez); `uninstaller.ts`
 * reexporta para manter a superfície pública inalterada.
 */
import { EventEmitter } from 'events'
import { execFileSync, spawn } from 'child_process'
import { existsSync, readdirSync, rmdirSync, rmSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import {
  detectKloudGames,
  mapMsiexecExitCode,
  getKloudGamesServiceStatus,
  type MsiexecExitCodeResult
} from '../uninstallDetection'
import { verifyKloudGamesRemoval } from '../uninstallVerify'
import {
  findKloudGamesExe,
  getKloudGamesUninstallLogPath,
  isKloudGamesRunning,
  invalidateKloudGamesRunningCache,
  looksLikeUacDenied,
  resetKloudGamesState,
  appendKloudGamesUninstallLog
} from '../kloudGames'
import {
  attachLaudo,
  type HubWipeResult,
  type UninstallProgress,
  type UninstallReport
} from './shared'

export const KLOUD_PROCESS_NAME = 'KLOUD_GAMES.exe'
export const KLOUD_TEMP_DIR_NAME = 'KLOUD_GAMES'

/** Máquina com o PowerShell bloqueado por política de execução (AppLocker/ConstrainedLanguage). */
export const POWERSHELL_BLOCKED_MESSAGE =
  'O PowerShell está bloqueado nesta máquina (política de execução). Desinstale pelo aplicativo Configurações do Windows.'

/** Não foi possível encerrar o processo do Kloud Games (duas tentativas de taskkill falharam). */
export const KLOUD_KILL_FAILED_MESSAGE =
  'Não foi possível encerrar o processo KLOUD_GAMES.exe. Feche-o pelo Gerenciador de Tarefas (Ctrl + Shift + Esc → aba Detalhes → KLOUD_GAMES.exe → Finalizar tarefa) e tente de novo.'

/**
 * Detecta o wrapper PowerShell "sem saída": código não-zero/nulo e nada no
 * stdout/stderr — assinatura de PowerShell bloqueado por política de execução.
 * Não cobre falhas normais do msiexec (que sempre emitem saída) nem o UAC
 * negado (detectado por `looksLikeUacDenied`). Exportada para testes.
 */
export function looksLikePowerShellBlocked(result: {
  exitCode: number | null
  output: string
}): boolean {
  return (result.exitCode === null || result.exitCode !== 0) && result.output.trim() === ''
}

/**
 * Só apaga pastas que casam EXATAMENTE com o padrão oficial de instalação
 * per-machine do Kloud Games (`<drive>:\Program Files\KLOUD_GAMES` ou
 * `…\Program Files (x86)\KLOUD_GAMES`). Qualquer outro caminho é recusado —
 * a remoção manual nunca toca pastas fora do padrão. Exportada para testes.
 */
export function isProgramFilesKloudGamesDir(target: string): boolean {
  if (typeof target !== 'string') return false
  const normalized = resolve(target).replace(/[\\/]+$/, '')
  return /^[a-z]:\\program files( \(x86\))?\\kloud_games$/i.test(normalized)
}

/**
 * Apaga o conteúdo de `targetDir` item a item (tolerante a falhas — nenhuma
 * exceção derruba o processo). Trava extra de `basename`: só opera em pastas
 * chamadas `KLOUD_GAMES`. A autorização do alvo (Program Files) acontece em
 * `uninstallOrphan` via `isProgramFilesKloudGamesDir`; aqui há a trava de
 * basename que também serve os testes (pastas temporárias KLOUD_GAMES).
 */
export function deleteKloudGamesOrphanFolder(
  targetDir: string,
  log: (line: string) => void,
  onItem?: (item: string, ok: boolean, error?: string) => void
): HubWipeResult {
  const result: HubWipeResult = { inventory: [], deleted: [], errors: [] }

  if (basename(join(targetDir, '.')).toLowerCase() !== 'kloud_games') {
    const message = `Recusando apagar pasta inesperada (esperado '...\\KLOUD_GAMES'): ${targetDir}`
    log(`[orphan] ${message}\n`)
    result.errors.push({ item: targetDir, error: message })
    return result
  }

  let entries: string[]
  try {
    entries = readdirSync(targetDir).sort((a, b) =>
      a.localeCompare(b, 'en', { sensitivity: 'base' })
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!existsSync(targetDir)) {
      // Já não existe — idempotente, nada a fazer.
      log('[orphan] A pasta de instalação não existe — nada para apagar.\n')
      return result
    }
    log(`[orphan] Não foi possível ler o inventário de ${targetDir}: ${message}\n`)
    result.errors.push({ item: targetDir, error: message })
    return result
  }

  result.inventory = entries
  log(
    `[orphan] Inventário de ${targetDir} (${entries.length} ${entries.length === 1 ? 'item' : 'itens'}): ${entries.join(', ') || '(pasta vazia)'}\n`
  )

  for (const entry of entries) {
    const target = join(targetDir, entry)
    try {
      rmSync(target, { recursive: true, force: true })
      result.deleted.push(entry)
      log(`[orphan] Apagado: ${entry}\n`)
      onItem?.(entry, true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push({ item: entry, error: message })
      log(`[orphan] Falha ao apagar ${entry}: ${message}\n`)
      onItem?.(entry, false, message)
    }
  }

  try {
    rmdirSync(targetDir)
  } catch {
    // Pasta não vazia (itens com falha) ou indisponível — eles ficam para o laudo.
  }

  return result
}

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

    const progress = (
      stepId: UninstallProgress['stepId'],
      status: UninstallProgress['status'],
      progress: number,
      message?: string
    ): void => {
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
        log(
          '[check] Kloud Games não está instalado (sem exe, sem registro, sem serviço) — idempotente.\n'
        )
        report.success = false
        report.error = 'O Kloud Games não está instalado.'
        report.stage = 'check'
        attachLaudo(report, log)
        return report
      }

      if (detection.entry?.productCode == null && detection.exePath == null) {
        progress('check', 'error', 0, 'Desinstalação pelo registro não encontrada.')
        log(
          '[check] Sem productCode do registro e sem exe: não é possível desinstalar via msiexec.\n'
        )
        report.success = false
        report.error =
          'Desinstalação pelo registro não encontrada — use Configurações do Windows → Aplicativos.'
        report.stage = 'check'
        attachLaudo(report, log)
        return report
      }

      progress('check', 'done', 100, 'Instalação verificada.')
      log('[check] Instalação do Kloud Games verificada.\n')

      // ── Etapa kill (15) — só quando o processo está rodando ────────
      if (await isKloudGamesRunning()) {
        invalidateKloudGamesRunningCache()
        progress('kill', 'running', 15, 'Encerrando Kloud Games…')
        log('[kill] Kloud Games está em execução; encerrando processo…\n')

        // Duas tentativas de encerrar o processo: direto, depois elevado.
        // Se as duas falharem, NÃO chamamos o msiexec — o exe em uso bloqueia
        // a remoção e ficaria metade-desinstalado. O usuário encerra pelo
        // Gerenciador de Tarefas e tenta de novo.
        let killed = false
        try {
          execFileSync('taskkill', ['/IM', KLOUD_PROCESS_NAME, '/F'], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 15000
          })
          killed = true
        } catch {
          log('[kill] Tentativa 1/2 (taskkill direto) falhou — tentando elevado via PowerShell…\n')
          // acesso negado → tenta elevado via PowerShell
          try {
            execFileSync(
              'powershell.exe',
              [
                '-NoProfile',
                '-Command',
                `Start-Process taskkill -Verb RunAs -ArgumentList '/IM','${KLOUD_PROCESS_NAME}','/F' -Wait`
              ],
              { encoding: 'utf8', windowsHide: true, timeout: 30000 }
            )
            killed = true
            log('[kill] Tentativa 2/2 (taskkill elevado) funcionou.\n')
          } catch {
            killed = false
          }
        }

        if (!killed) {
          progress('kill', 'error', 0, KLOUD_KILL_FAILED_MESSAGE)
          log(
            '[kill] Tentativa 2/2 (taskkill elevado) também falhou — abortando antes do msiexec.\n'
          )
          report.success = false
          report.error = KLOUD_KILL_FAILED_MESSAGE
          report.stage = 'kill'
          attachLaudo(report, log)
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
        report.stage = 'msiexec'
        attachLaudo(report, log)
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

      // Wrapper PowerShell sem saída E código sem significado conhecido → a
      // máquina bloqueia o PowerShell por política de execução. Nunca vira
      // "erro desconhecido" genérico nem derruba o processo. Códigos
      // conhecidos pelo mapa (0/1602/1605/…) têm significado próprio e seguem
      // o fluxo normal — mesmo com saída vazia.
      const mapped = mapMsiexecExitCode(elevated.exitCode)
      const powerShellBlocked =
        mapped.kind === 'unknown' &&
        looksLikePowerShellBlocked(elevated) &&
        !looksLikeUacDenied(elevated.output)
      if (powerShellBlocked) {
        progress('msiexec', 'error', 0, POWERSHELL_BLOCKED_MESSAGE)
        log(`[msiexec] ${POWERSHELL_BLOCKED_MESSAGE}\n`)
        appendKloudGamesUninstallLog(
          `PowerShell bloqueado por política de execução (código ${elevated.exitCode ?? 'desconhecido'})`
        )
        report.success = false
        report.error = POWERSHELL_BLOCKED_MESSAGE
        report.stage = 'msiexec'
        attachLaudo(report, log)
        return report
      }

      let msiexecResult: MsiexecExitCodeResult = mapMsiexecExitCode(elevated.exitCode)
      if (looksLikeUacDenied(elevated.output)) {
        msiexecResult = mapMsiexecExitCode(1223)
      }
      report.msiexecKind = msiexecResult.kind

      const msiexecFail = (kindError: string): UninstallReport => {
        progress('msiexec', 'error', 0, kindError)
        report.success = false
        report.error = kindError
        report.stage = 'msiexec'
        attachLaudo(report, log)
        return report
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
          attachLaudo(report, log)
          return report
        case 'uac-denied':
          report.success = false
          report.cancelled = true
          report.error = msiexecResult.message
          log(`[msiexec] ${msiexecResult.message}\n`)
          attachLaudo(report, log)
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
          return msiexecFail(msiexecResult.message)
      }

      progress('msiexec', 'done', 80, 'Remoção do MSI concluída.')
      log('[msiexec] Remoção do MSI concluída.\n')

      // ── Etapa verify (85) — mínimo inline (T3 trará o laudo completo) ─
      progress('verify', 'running', 85, 'Verificando a remoção…')
      log('[verify] Zerando estado salvo e verificando remoção…\n')
      resetKloudGamesState()
      const exeStillExists = findKloudGamesExe() !== null
      if (exeStillExists) {
        report.remaining.push(
          'O executável KLOUD_GAMES.exe ainda foi detectado após a desinstalação.'
        )
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
      // Mescla o que já foi anotado (ex.: nova versão) com o laudo, sem duplicar.
      const merged = [...report.remaining]
      for (const item of verify.remaining) {
        if (!merged.includes(item)) merged.push(item)
      }
      report.remaining = merged
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
      report.stage = 'done'
      return report
    } catch (err) {
      // Rede de segurança: nenhuma exceção pode passar crua para o IPC — a UI
      // sempre recebe um `uninstall:complete` com erro amigável e o laudo.
      const message = err instanceof Error ? err.message : String(err)
      log(`[uninstall] Erro inesperado: ${message}\n`)
      appendKloudGamesUninstallLog(`Erro inesperado no fluxo de desinstalação: ${message}`)
      report.success = false
      report.error = report.error ?? `Falha inesperada ao desinstalar o Kloud Games: ${message}`
      report.stage = report.stage ?? 'unknown'
      attachLaudo(report, log)
      return report
    } finally {
      this.isUninstalling = false
      // SEMPRE emite complete — sem isto a UI ficaria presa em "running".
      try {
        this.emit('complete', report)
      } catch {
        // Sem ouvintes (ex.: teste) — nada a fazer.
      }
    }
  }

  /**
   * Remoção MANUAL PARCIAL para instalações quebradas do tipo exe-órfão
   * (arquivos presentes, registro e serviço ausentes): apaga SOMENTE a pasta
   * `C:\Program Files\KLOUD_GAMES` (ou `…\Program Files (x86)\KLOUD_GAMES`)
   * e zera o estado salvo. Nada do registro é alterado; o serviço e o
   * firewall (se existissem) NÃO são tocados — por isso o laudo fica sempre
   * marcado como "remoção manual parcial".
   *
   * Guardas: (1) reentrância via `isUninstalling`; (2) nunca roda quando o
   * registro consta (o caminho correto é o msiexec); (3) só alvos que casam
   * com o padrão oficial de instalação — qualquer outra pasta é recusada e
   * nada é apagado.
   */
  async uninstallOrphan(emit: (evt: UninstallProgress) => void): Promise<UninstallReport> {
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
      logPath,
      stage: 'orphan',
      orphanManual: true
    }

    const progress = (
      stepId: UninstallProgress['stepId'],
      status: UninstallProgress['status'],
      progressValue: number,
      message?: string
    ): void => {
      const evt: UninstallProgress = { stepId, status, progress: progressValue, message }
      emit(evt)
      this.emit('progress', evt)
    }

    const log = (line: string): void => {
      this.emit('log', line)
    }

    try {
      progress('check', 'running', 5, 'Verificando a instalação quebrada…')
      log('[orphan] Verificando os restos da instalação do Kloud Games…\n')

      const detection = detectKloudGames()

      // Não é órfão ou o MSI ainda é possível → nunca apaga nada aqui.
      if (detection.status === 'installed' || detection.entry?.productCode != null) {
        report.error =
          'O Kloud Games consta no registro — use a desinstalação normal (botão "Desinstalar pelo registro"). Nada foi removido.'
        log(
          '[orphan] Registro consta — a remoção manual foi recusada (o msiexec é o caminho correto).\n'
        )
        attachLaudo(report, log)
        return report
      }

      if (!detection.exePath) {
        if (detection.service !== 'missing') {
          report.error =
            'Só o serviço KLOUD_GAMESsvc foi encontrado — não há arquivos para remover. Use o botão "Remover serviço agora".'
          log('[orphan] Apenas o serviço KLOUD_GAMESsvc presente — nada a apagar.\n')
        } else {
          report.error = 'O Kloud Games não está instalado.'
          log('[orphan] Não há exe nem serviço — nada a remover.\n')
        }
        attachLaudo(report, log)
        return report
      }

      const target = dirname(detection.exePath)
      if (!isProgramFilesKloudGamesDir(target)) {
        report.error = `Por segurança, o Hub só apaga pastas no padrão oficial (C:\\Program Files\\KLOUD_GAMES). Apague manualmente pelo Explorador de Arquivos: ${target}`
        log(`[orphan] Recusado: pasta fora do padrão oficial — ${target}\n`)
        attachLaudo(report, log)
        return report
      }

      appendKloudGamesUninstallLog(`Remoção manual parcial (órfão) iniciada\nPasta: ${target}`)
      progress('cleanup', 'running', 20, 'Removendo somente os arquivos restantes…')

      let done = 0
      const wipe = deleteKloudGamesOrphanFolder(target, log, () => {
        done += 1
        progress(
          'cleanup',
          'running',
          Math.min(90, 20 + done * 5),
          'Removendo somente os arquivos restantes…'
        )
      })

      for (const wipeError of wipe.errors) {
        report.remaining.push(`${wipeError.item}: ${wipeError.error}`)
      }

      // Zera o estado salvo (a "Instalação quebrada" deixa de ser reportada).
      resetKloudGamesState()
      removeTempKloudGamesDir()

      const verify = verifyKloudGamesRemoval()
      report.report = verify
      const merged = [...report.remaining]
      for (const item of verify.remaining) {
        if (!merged.includes(item)) merged.push(item)
      }
      if (verify.serviceGone && verify.registryGone) {
        merged.push(
          'Remoção manual parcial — o serviço KLOUD_GAMESsvc e o firewall não existiam; nada do registro foi alterado.'
        )
      } else {
        merged.push(
          'Remoção manual parcial — o serviço e o firewall (se existiam) NÃO foram tocados; remova-os separadamente (ex.: "Remover serviço agora"). Nada do registro foi alterado.'
        )
      }
      report.remaining = merged
      report.success = wipe.errors.length === 0 && verify.exeGone
      log(
        `[orphan] Remoção manual ${report.success ? 'concluída' : 'concluída com falhas'} — ${wipe.deleted.length} ${wipe.deleted.length === 1 ? 'item apagado' : 'itens apagados'}${wipe.errors.length > 0 ? `, ${wipe.errors.length} falha(s)` : ''}.\n`
      )

      progress('cleanup', 'done', 100, 'Remoção manual concluída.')
      progress('done', 'done', 100, 'Concluído')
      report.stage = 'done'
      return report
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log(`[orphan] Erro inesperado: ${message}\n`)
      appendKloudGamesUninstallLog(`Erro inesperado na remoção manual parcial: ${message}`)
      report.success = false
      report.error = `Falha inesperada na remoção manual: ${message}`
      report.stage = 'orphan'
      attachLaudo(report, log)
      return report
    } finally {
      this.isUninstalling = false
      try {
        this.emit('complete', report)
      } catch {
        // Sem ouvintes (ex.: teste) — nada a fazer.
      }
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

/**
 * Remoção manual parcial de uma instalação quebrada do Kloud Games
 * (exe órfão: arquivos sem registro e sem serviço). Nunca toca no registro,
 * no serviço nem no firewall — apaga somente a pasta de instalação oficial.
 *
 * Após qualquer desinstalação deste módulo, ensureKloudGamesInstalled()
 * (kloudGames.ts) reinstala o MSI normalmente na próxima abertura do Hub —
 * o que garante isso é o `kloud-games.paths.json` regravado com
 * `exePath: null` (resetKloudGamesState). Nunca restaure caminhos à mão.
 */
export async function uninstallKloudGamesOrphanFiles(
  emit: (evt: UninstallProgress) => void
): Promise<UninstallReport> {
  return uninstaller.uninstallOrphan(emit)
}

/**
 * Remove o serviço KLOUD_GAMESsvc via `sc.exe delete` ELEVADO
 * (PowerShell `Start-Process -Verb RunAs -Wait` — mesmo padrão de elevação
 * do launchInstallerElevated). Nunca executa `sc delete` direto. O resultado
 * é registrado no log de desinstalação. Exportada para uso pelo IPC e testes.
 */
export async function removeKloudGamesService(): Promise<{
  success: boolean
  error?: string
  serviceStatus?: string
}> {
  const command = `$p = Start-Process sc.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList 'delete','KLOUD_GAMESsvc'; exit $p.ExitCode`
  appendKloudGamesUninstallLog(
    `Remoção do serviço KLOUD_GAMESsvc solicitada pelo usuário (botão "Remover serviço agora")\nComando: powershell.exe -NoProfile -Command ${command}`
  )
  const elevated = await runElevatedPowerShell(command)
  appendKloudGamesUninstallLog(
    `sc.exe delete — código de saída: ${elevated.exitCode ?? 'desconhecido'}\nSaída:\n${elevated.output.trim() || '(sem saída)'}`
  )

  if (looksLikePowerShellBlocked(elevated) && !looksLikeUacDenied(elevated.output)) {
    return { success: false, error: POWERSHELL_BLOCKED_MESSAGE, serviceStatus: 'unknown' }
  }
  if (looksLikeUacDenied(elevated.output)) {
    return { success: false, error: mapMsiexecExitCode(1223).message, serviceStatus: 'unknown' }
  }

  const status = getKloudGamesServiceStatus()
  if (status === 'missing') {
    appendKloudGamesUninstallLog('Serviço KLOUD_GAMESsvc ausente após a remoção (sucesso).')
    return { success: true, serviceStatus: status }
  }
  appendKloudGamesUninstallLog(
    `Serviço KLOUD_GAMESsvc ainda presente após a tentativa (status: ${status}).`
  )
  return {
    success: false,
    error: `O Windows não removeu o serviço KLOUD_GAMESsvc (código ${elevated.exitCode ?? 'desconhecido'}). Fale com o administrador ou use um Prompt de Comando ELEVADO: sc delete KLOUD_GAMESsvc.`,
    serviceStatus: status
  }
}

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
