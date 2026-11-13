import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { EventEmitter } from 'events'
import { execFileSync, spawn, type ChildProcess } from 'child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmdirSync, rmSync } from 'fs'
import { basename, dirname, join } from 'path'
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

// ── Fluxo "Desinstalar Kolnd Hub" (T5) ─────────────────────────────────

/** Argumentos do `uninstall:hub` — já normalizados por `normalizeHubUninstallArgs`. */
export interface HubUninstallArgs {
  /** Apagar %APPDATA%\kolnd-hub inteiro (irreversível). Default: false (nunca apaga). */
  wipeUserData: boolean
  /** Pular a etapa do Kloud Games (o usuário escolheu desinstalar só o Hub). Default: false. */
  skipKloud: boolean
  /** Caminho do backup feito antes da confirmação (só entra no log). Default: null. */
  backupPath: string | null
}

/** Steps do fluxo do Hub reemitidos em `uninstall:progress`. */
export const HUB_UNINSTALL_STEPS = ['kloud', 'backup', 'wipe', 'spawn', 'done'] as const

/** Resultado retornado pelo `uninstall:hub` ao main (que decide o encerramento). */
export interface HubUninstallResult {
  ok: boolean
  error?: string
  /** true quando o desinstalador NSIS foi iniciado (app deve fechar em seguida). */
  spawned?: boolean
  /** true quando a etapa do Kloud Games falhou e a UI deve perguntar "só o Hub?". */
  paused?: boolean
  kloudError?: string
  wipeErrors?: string[]
}

/** Payload de `uninstall:complete` emitido pelo fluxo do Hub. */
export interface HubUninstallComplete {
  success: boolean
  error?: string
  paused?: boolean
  kloudError?: string
  stage?: string
  wipeErrors?: string[]
}

/** StepIds internos do fluxo do Kloud Games (não devem chegar crus à UI do Hub). */
const KLOUD_SUBSTEP_IDS = new Set(['check', 'kill', 'msiexec', 'verify', 'cleanup', 'done'])

/** Guarda de reentrância do fluxo completo do Hub (a T2 tem a dela no Uninstaller). */
let hubUninstallInProgress = false

export function isHubUninstallInProgress(): boolean {
  return hubUninstallInProgress
}

/** Mantém o renderer livre de eventos crus do subfluxo do Kloud Games. */
export function isKloudSubstepEvent(stepId: string): boolean {
  return KLOUD_SUBSTEP_IDS.has(stepId)
}

/**
 * Valida/normaliza o payload cru do IPC `uninstall:hub`.
 * Default-safe: qualquer coisa fora do formato vira wipe=false / skipKloud=false / sem backup.
 */
export function normalizeHubUninstallArgs(raw: unknown): HubUninstallArgs {
  const obj =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const wipeUserData = obj.wipeUserData === true
  const skipKloud = obj.skipKloud === true
  const backupPathRaw = obj.backupPath
  const backupPath =
    typeof backupPathRaw === 'string' && backupPathRaw.trim().length > 0
      ? backupPathRaw.trim().slice(0, 1024)
      : null
  return { wipeUserData, skipKloud, backupPath }
}

export interface HubWipeItemError {
  item: string
  error: string
}

export interface HubWipeResult {
  /** Entradas top-level encontradas ANTES de apagar (inventário). */
  inventory: string[]
  /** Entradas apagadas com sucesso. */
  deleted: string[]
  /** Falhas item a item (não impedem os demais). */
  errors: HubWipeItemError[]
}

/**
 * Apaga recursivamente o conteúdo de `rootDir`, tolerando falhas item a item.
 *
 * Segurança: só opera dentro de uma pasta chamada `kolnd-hub` — nunca toca em
 * nada fora de %APPDATA%\kolnd-hub. O `rootDir` é sempre resolvido por quem
 * chama; aqui há apenas uma trava extra de `basename`.
 */
export function wipeKolndHubUserData(
  rootDir: string,
  log: (line: string) => void,
  onItem: (item: string, ok: boolean, error?: string) => void,
  onInventory?: (count: number) => void
): HubWipeResult {
  const result: HubWipeResult = { inventory: [], deleted: [], errors: [] }

  // Trava de segurança: nunca operar fora de ...\kolnd-hub.
  if (basename(join(rootDir, '.')).toLowerCase() !== 'kolnd-hub') {
    const message = `Recusando apagar pasta inesperada (esperado '...\\kolnd-hub'): ${rootDir}`
    log(`[wipe] ${message}\n`)
    result.errors.push({ item: rootDir, error: message })
    return result
  }

  let entries: string[]
  try {
    entries = readdirSync(rootDir).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (existsSync(rootDir)) {
      // Pasta existe mas não pôde ser lida (permissão/bloqueio).
      log(`[wipe] Não foi possível ler o inventário de ${rootDir}: ${message}\n`)
    } else {
      log('[wipe] %APPDATA%\\kolnd-hub não existe — nada para apagar.\n')
    }
    result.errors.push({ item: rootDir, error: message })
    return result
  }

  result.inventory = entries
  onInventory?.(entries.length)
  log(
    `[wipe] Inventário de %APPDATA%\\kolnd-hub (${entries.length} ${entries.length === 1 ? 'item' : 'itens'}): ${entries.join(', ') || '(pasta vazia)'}\n`
  )

  for (const entry of entries) {
    const target = join(rootDir, entry)
    try {
      rmSync(target, { recursive: true, force: true })
      result.deleted.push(entry)
      log(`[wipe] Apagado: ${entry}\n`)
      onItem(entry, true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push({ item: entry, error: message })
      log(`[wipe] Falha ao apagar ${entry}: ${message}\n`)
      onItem(entry, false, message)
    }
  }

  // Se sobrou alguma coisa (falhas), a pasta permanece com esses itens; senão, remove a raiz.
  try {
    rmdirSync(rootDir)
  } catch {
    // Não vazia ou indisponível — os itens com falha ficam para o laudo.
  }

  return result
}

/** Spawn desanexado do desinstalador NSIS; resolve no evento 'spawn', rejeita no 'error'. */
export function spawnHubUninstaller(uninstallerPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(uninstallerPath, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }

    const cleanup = (): void => {
      child.removeListener('error', onError)
      child.removeListener('spawn', onSpawn)
    }
    const onError = (err: Error): void => {
      cleanup()
      reject(err)
    }
    const onSpawn = (): void => {
      cleanup()
      try {
        child.unref()
      } catch {
        // Melhor esforço: o processo desanexado já foi criado.
      }
      resolve()
    }

    child.on('error', onError)
    child.on('spawn', onSpawn)
  })
}

const HUB_UNINSTALLER_NOT_FOUND =
  'Desinstalador não encontrado — desinstale pelo aplicativo Configurações do Windows → Aplicativos → Kolnd Hub'

/**
 * Sequência completa "Desinstalar Kolnd Hub".
 *
 * ORDEM (obrigatória — não inverter):
 *   0. resolver o desinstalador (findHubUninstaller) — ANTES de qualquer destruição;
 *   1. kloud  — reusa o fluxo da T2 (`uninstallKloudGames`); falha ⇒ emite
 *               `uninstall:complete` { paused: true, stage: 'kloud' } e PARA;
 *   2. backup — apenas loga "backup já feito em <caminho>" (o backup é voluntário
 *               e feito pela UI antes da confirmação, via `uninstall:backup-data`);
 *   3. wipe   — só se `wipeUserData === true`; apagar a pasta inteira
 *               %APPDATA%\kolnd-hub item a item, tolerando falhas;
 *   4. spawn  — inicia o desinstalador NSIS desanexado;
 *   5. quem chamou encerra o Hub (killAll + destroy + app.quit) se spawned.
 *
 * Nunca apaga nada fora de %APPDATA%\kolnd-hub. O guard de reentrância impede
 * duas execuções simultâneas — o mesmo erro da T2.
 */
export async function runHubUninstallSteps(
  rawArgs: unknown,
  emit: (evt: UninstallProgress) => void
): Promise<HubUninstallResult> {
  if (hubUninstallInProgress) {
    return {
      ok: false,
      error: 'Desinstalação já em andamento. Aguarde o término e tente de novo.'
    }
  }
  hubUninstallInProgress = true

  const args = normalizeHubUninstallArgs(rawArgs)
  const log = (line: string): void => {
    uninstaller.emit('log', line)
  }
  const progress = (
    stepId: (typeof HUB_UNINSTALL_STEPS)[number],
    status: UninstallProgress['status'],
    progressValue: number,
    message?: string
  ): void => {
    emit({ stepId, status, progress: Math.max(0, Math.min(100, Math.round(progressValue))), message })
  }
  const complete = (result: HubUninstallComplete): void => {
    uninstaller.emit('complete', result)
  }

  try {
    // ── Etapa 0 — resolver o desinstalador (antes de QUALQUER destruição) ──
    log('[spawn] Resolvendo o caminho do desinstalador do Kolnd Hub…\n')
    const hubUninstaller = findHubUninstaller()
    if (!app.isPackaged || !hubUninstaller.available || !hubUninstaller.uninstallerPath) {
      log(`[spawn] ${HUB_UNINSTALLER_NOT_FOUND}\n`)
      progress('spawn', 'error', 0, HUB_UNINSTALLER_NOT_FOUND)
      complete({ success: false, error: HUB_UNINSTALLER_NOT_FOUND, stage: 'spawn' })
      return { ok: false, error: HUB_UNINSTALLER_NOT_FOUND }
    }
    log(
      `[spawn] Desinstalador localizado: ${hubUninstaller.uninstallerPath} (fonte: ${hubUninstaller.source ?? 'desconhecida'})\n`
    )

    // ── Etapa kloud ─────────────────────────────────────────────────────
    if (args.skipKloud) {
      log('[kloud] Pulando o Kloud Games (você escolheu desinstalar só o Hub).\n')
      progress('kloud', 'done', 70, 'Kloud Games pulado')
    } else {
      progress('kloud', 'running', 5, 'Verificando o Kloud Games…')
      const detection = detectKloudGames()
      if (detection.status === 'missing') {
        log('[kloud] Kloud Games não instalado — pulando.\n')
        progress('kloud', 'done', 70, 'Kloud Games não instalado — pulando')
      } else {
        const report = await uninstallKloudGames((evt: UninstallProgress) => {
          // Mapeia o 0–100 do fluxo da T2 para a faixa kloud (0–70) do fluxo do Hub.
          progress('kloud', evt.status, evt.progress * 0.7, evt.message)
        })

        if (!report.success) {
          const kloudError =
            report.error ?? 'Falha desconhecida ao desinstalar o Kloud Games.'
          log(`[kloud] Falha ao desinstalar o Kloud Games: ${kloudError}\n`)
          appendKloudGamesUninstallLog(
            `Desinstalação do Kolnd Hub pausada na etapa kloud: ${kloudError}`
          )
          complete({ success: false, paused: true, kloudError, stage: 'kloud' })
          return { ok: false, paused: true, kloudError }
        }
        progress('kloud', 'done', 70, 'Kloud Games desinstalado')
      }
    }

    // ── Etapa backup — só loga (o backup é voluntário e já aconteceu, se houve) ──
    if (args.backupPath) {
      log(`[backup] Backup já feito em ${args.backupPath}\n`)
      progress('backup', 'done', 78, `Backup salvo em ${args.backupPath}`)
    } else {
      log('[backup] Nenhum backup informado — seguindo sem cópia dos seus dados.\n')
      progress('backup', 'done', 78, 'Sem backup (opcional)')
    }

    // ── Etapa wipe — só se o usuário escolheu apagar os dados ────────────
    let wipeErrors: string[] | undefined
    if (args.wipeUserData) {
      progress('wipe', 'running', 80, 'Apagando seus dados em %APPDATA%\\kolnd-hub…')
      const rootDir = join(app.getPath('appData'), 'kolnd-hub')
      let wipeTotal = 1
      let wipeDone = 0
      const wipe = wipeKolndHubUserData(
        rootDir,
        log,
        (_item, ok) => {
          wipeDone += 1
          if (ok) {
            // Faixa do wipe: 80 → 92 (12 pontos distribuídos pelos itens).
            progress('wipe', 'running', 80 + (wipeDone * 12) / wipeTotal)
          }
        },
        (count) => {
          if (count > 0) wipeTotal = count
        }
      )
      wipeErrors = wipe.errors.map((e) => `${e.item}: ${e.error}`)
      if (wipe.errors.length > 0) {
        log(
          `[wipe] ${wipe.errors.length} ${wipe.errors.length === 1 ? 'item falhou' : 'itens falharam'} — o desinstalador seguirá mesmo assim. Veja os itens acima.\n`
        )
        progress(
          'wipe',
          'done',
          92,
          `Dados apagados com ${wipe.errors.length} falha(s) — detalhes no log`
        )
      } else {
        progress('wipe', 'done', 92, 'Seus dados foram apagados')
      }
    } else {
      log('[wipe] wipeUserData=false — nada será apagado (dados e configurações preservados).\n')
      progress('wipe', 'done', 92, 'Seus dados foram mantidos')
    }

    // ── Etapa spawn — inicia o desinstalador NSIS ────────────────────────
    progress('spawn', 'running', 96, 'Iniciando o desinstalador do Kolnd Hub…')
    log('[spawn] Iniciando o desinstalador (per-user, sem exigir admin)…\n')
    try {
      await spawnHubUninstaller(hubUninstaller.uninstallerPath)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const error = `Não foi possível iniciar o desinstalador do Kolnd Hub: ${message}. Desinstale pelo aplicativo Configurações do Windows → Aplicativos → Kolnd Hub.`
      log(`[spawn] ${error}\n`)
      complete({ success: false, error, stage: 'spawn' })
      return { ok: false, error }
    }
    log('[spawn] Desinstalador iniciado. O Kolnd Hub será encerrado para ele assumir.\n')
    progress('spawn', 'done', 100, 'Desinstalador iniciado')
    progress('done', 'done', 100, 'Concluído')
    log('[done] Kolnd Hub sendo encerrado — o desinstalador do Windows conclui o resto.\n')
    complete({ success: true, stage: 'spawn', wipeErrors })
    return { ok: true, spawned: true, wipeErrors }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const error = `Falha inesperada na desinstalação do Kolnd Hub: ${message}`
    log(`[hub] ${error}\n`)
    complete({ success: false, error, stage: 'unknown' })
    return { ok: false, error }
  } finally {
    hubUninstallInProgress = false
  }
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

/** Completions emitidos pelo fluxo do Hub sempre carregam `stage` — distingue do laudo da T2. */
function isHubUninstallComplete(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    typeof (result as { stage?: unknown }).stage === 'string'
  )
}

/**
 * Registra os canais IPC de desinstalação do Kloud Games e do Kolnd Hub (T5).
 * O canal `uninstall:hub` em si é registrado em `main/index.ts` (junto a
 * `shutdownHub`); aqui ficam os ouvintes que reenviam os eventos.
 */
export function registerUninstallIpc(getWindow: () => BrowserWindow | null): void {
  // Reencaminha eventos do Uninstaller para o renderer.
  // Durante o fluxo do Hub (T5), os eventos crus do subfluxo do Kloud Games
  // (check/kill/msiexec/… e o laudo final) são ignorados: o Hub reemite seus
  // próprios eventos de progresso/complete com os steps do Hub.
  uninstaller.on('progress', (data: UninstallProgress) => {
    if (isHubUninstallInProgress() && isKloudSubstepEvent(data.stepId)) return
    getWindow()?.webContents.send('uninstall:progress', data)
  })

  uninstaller.on('log', (line: UninstallLogLine) => {
    getWindow()?.webContents.send('uninstall:log', line)
  })

  uninstaller.on('complete', (result: UninstallReport) => {
    if (isHubUninstallInProgress() && !isHubUninstallComplete(result)) return
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
