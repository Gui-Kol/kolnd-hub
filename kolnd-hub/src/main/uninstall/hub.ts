/**
 * Domínio Hub da desinstalação (T4 do split de uninstaller.ts):
 * sequência "Desinstalar Kolnd Hub" (kloud → backup → spawn → wipe),
 * wipe de %APPDATA%\kolnd-hub, spawn desanexado do desinstalador NSIS
 * e filtros/guards dos eventos do fluxo.
 *
 * O estado de reentrância (`hubUninstallInProgress`) vive em `./shared`
 * (dono compartilhado); aqui só o lemos/definimos via set/is.
 * `uninstaller.ts` reexporta tudo para manter a superfície pública inalterada.
 */
import { app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { existsSync, readdirSync, rmdirSync, rmSync } from 'fs'
import { basename, join } from 'path'
import { findHubUninstaller, detectKloudGames } from '../uninstallDetection'
import { appendKloudGamesUninstallLog } from '../kloudGames'
import { uninstaller, uninstallKloudGames } from './kloud'
import {
  isHubUninstallInProgress,
  setHubUninstallInProgress,
  type HubWipeResult,
  type UninstallProgress
} from './shared'

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
export const HUB_UNINSTALL_STEPS = ['kloud', 'backup', 'spawn', 'wipe', 'done'] as const

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
 *   3. spawn  — inicia o desinstalador NSIS desanexado; falha ⇒ emite
 *               `uninstall:complete` { success: false, stage: 'spawn' } e PARA,
 *               sem apagar nada (é por isso que o spawn vem antes do wipe);
 *   4. wipe   — só se `wipeUserData === true`; apagar a pasta inteira
 *               %APPDATA%\kolnd-hub item a item, tolerando falhas — apenas
 *               depois do spawn confirmado (falha de spawn não destrói dados);
 *   5. quem chamou encerra o Hub (killAll + destroy + app.quit) se spawned.
 *
 * Nunca apaga nada fora de %APPDATA%\kolnd-hub. O guard de reentrância impede
 * duas execuções simultâneas — o mesmo erro da T2.
 */
export async function runHubUninstallSteps(
  rawArgs: unknown,
  emit: (evt: UninstallProgress) => void
): Promise<HubUninstallResult> {
  if (isHubUninstallInProgress()) {
    return {
      ok: false,
      error: 'Desinstalação já em andamento. Aguarde o término e tente de novo.'
    }
  }
  setHubUninstallInProgress(true)

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
    emit({
      stepId,
      status,
      progress: Math.max(0, Math.min(100, Math.round(progressValue))),
      message
    })
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
          const kloudError = report.error ?? 'Falha desconhecida ao desinstalar o Kloud Games.'
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

    // ── Etapa spawn — inicia o desinstalador NSIS antes de qualquer wipe ──
    // A ordem importa: se o spawn falhar, nada em %APPDATA%\kolnd-hub foi
    // apagado ainda — o wipe só roda depois do spawn confirmado.
    progress('spawn', 'running', 80, 'Iniciando o desinstalador do Kolnd Hub…')
    log('[spawn] Iniciando o desinstalador (per-user, sem exigir admin)…\n')
    try {
      await spawnHubUninstaller(hubUninstaller.uninstallerPath)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const error = `Não foi possível iniciar o desinstalador do Kolnd Hub: ${message}. Desinstale pelo aplicativo Configurações do Windows → Aplicativos → Kolnd Hub.`
      log(`[spawn] ${error}\n`)
      // Nenhum dado foi apagado: o wipe só roda depois do spawn confirmado.
      // A UI mostra o erro com a instrução manual de desinstalação.
      complete({ success: false, error, stage: 'spawn' })
      return { ok: false, error }
    }
    log('[spawn] Desinstalador iniciado. O Kolnd Hub será encerrado para ele assumir.\n')
    progress('spawn', 'done', 88, 'Desinstalador iniciado')

    // ── Etapa wipe — só se o usuário escolheu apagar os dados ────────────
    let wipeErrors: string[] | undefined
    if (args.wipeUserData) {
      progress('wipe', 'running', 90, 'Apagando seus dados em %APPDATA%\\kolnd-hub…')
      const rootDir = join(app.getPath('appData'), 'kolnd-hub')
      let wipeTotal = 1
      let wipeDone = 0
      const wipe = wipeKolndHubUserData(
        rootDir,
        log,
        (_item, ok) => {
          wipeDone += 1
          if (ok) {
            // Faixa do wipe: 90 → 98 (8 pontos distribuídos pelos itens).
            progress('wipe', 'running', 90 + (wipeDone * 8) / wipeTotal)
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
          98,
          `Dados apagados com ${wipe.errors.length} falha(s) — detalhes no log`
        )
      } else {
        progress('wipe', 'done', 98, 'Seus dados foram apagados')
      }
    } else {
      log('[wipe] wipeUserData=false — nada será apagado (dados e configurações preservados).\n')
      progress('wipe', 'done', 98, 'Seus dados foram mantidos')
    }

    progress('done', 'done', 100, 'Concluído')
    log('[done] Kolnd Hub sendo encerrado — o desinstalador do Windows conclui o resto.\n')
    complete({ success: true, stage: 'spawn', wipeErrors })
    return { ok: true, spawned: true, wipeErrors }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const error = `Falha inesperada na desinstalação do Kolnd Hub: ${message}`
    log(`[hub] ${error}\n`)
    complete({ success: false, error, stage: 'hub' })
    return { ok: false, error }
  } finally {
    setHubUninstallInProgress(false)
  }
}

/**
 * Filtra o evento `complete` durante o fluxo do Hub: os reemitidos pelo Hub
 * carregam um `stage` do conjunto abaixo; os crus do subfluxo do Kloud Games
 * (check/kill/msiexec/verify/cleanup/done/orphan/unknown) são suprimidos para
 * não piscar na UI ou disparar fase errada no modal do Hub.
 */
const HUB_COMPLETE_STAGES = new Set(['kloud', 'backup', 'wipe', 'spawn', 'hub'])

export function isHubUninstallComplete(result: unknown): boolean {
  const stage = (result as { stage?: unknown } | null)?.stage
  return typeof stage === 'string' && HUB_COMPLETE_STAGES.has(stage)
}
