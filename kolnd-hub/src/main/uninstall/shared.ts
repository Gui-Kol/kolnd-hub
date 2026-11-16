import type { BrowserWindow } from 'electron'
// Import APENAS para uso em tempo de chamada (dentro de `isAnyUninstallInProgress`).
// Ciclo compartilhado shared ↔ kloud tolerado por ESM: nada é dereferenciado em
// eval-time (o flag e as funções só são chamados dentro de handlers/fluxos).
import { uninstaller } from './kloud'
import { verifyKloudGamesRemoval, type KloudGamesUninstallReport } from '../uninstallVerify'
import type { MsiexecExitCodeKind } from '../uninstallDetection'

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
  /** Etapa do fluxo onde o resultado terminou ('check' | 'kill' | 'msiexec' | 'verify' | 'cleanup' | 'done' | 'orphan'). */
  stage?: string
  /** Kind do código retornado pelo msiexec (quando veio do mapa de códigos). */
  msiexecKind?: MsiexecExitCodeKind
  /** true quando o laudo veio da remoção manual parcial de arquivos (órfãos). */
  orphanManual?: boolean
}

/** Laudo pós-desinstalação anexado a TODAS as vertentes de saída do fluxo (best-effort). */
export function attachLaudo(report: UninstallReport, log: (line: string) => void): void {
  try {
    const verify = verifyKloudGamesRemoval()
    report.report = verify
    const merged = [...report.remaining]
    for (const item of verify.remaining) {
      if (!merged.includes(item)) merged.push(item)
    }
    report.remaining = merged
    if (verify.remaining.length > 0) {
      log(`[laudo] Itens remanescentes: ${verify.remaining.join('; ')}\n`)
    }
  } catch (err) {
    log(
      `[laudo] Não foi possível gerar o laudo de verificação: ${
        err instanceof Error ? err.message : String(err)
      }\n`
    )
  }
}

/**
 * Resultado item a item de uma varredura/apagamento de pasta (inventário antes,
 * apagados e falhas depois).
 *
 * Nome mantido com o prefixo `HubWipe` por compatibilidade com o plano T4/T5:
 * originalmente viveria em `uninstall/hub.ts`, mas nesta etapa (T3) o domínio
 * Kloud (`deleteKloudGamesOrphanFolder`) já precisa do tipo e hub.ts ainda não
 * existe. HubWipe* fica em `./shared` até a T4, que passa a importá-los daqui.
 */
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

/** Janela principal (registrada por `registerUninstallIpc`) para travar fechar/minimizar. */
let uninstallWindowGetter: (() => BrowserWindow | null) | null = null

/** Guarda de reentrância do fluxo completo do Hub (o Uninstaller tem a dele). */
let hubUninstallInProgress = false

/** Define o flag de reentrância do fluxo "Desinstalar Kolnd Hub" (usado por `uninstall/hub.ts`). */
export function setHubUninstallInProgress(value: boolean): void {
  hubUninstallInProgress = value
}

/** true enquanto o fluxo "Desinstalar Kolnd Hub" está em execução. */
export function isHubUninstallInProgress(): boolean {
  return hubUninstallInProgress
}

/** Guarda compartilhada: true se QUALQUER fluxo destrutivo está em andamento. */
export function isAnyUninstallInProgress(): boolean {
  return uninstaller.isBusy() || hubUninstallInProgress
}

/** Registra (ou limpa, com `null`) a janela principal usada pelos helpers de trava de janela. */
export function setUninstallWindowGetter(getter: (() => BrowserWindow | null) | null): void {
  uninstallWindowGetter = getter
}

/**
 * Trava a janela durante os passos DESTRUTIVOS do fluxo de desinstalação:
 * a janela não pode ser fechada/minimizada (Alt+F4 e X do title bar ficam
 * inertes) até a saída do fluxo. Nunca lança — qualquer falha de `setClosable`
 * é ignorada (a UI continua protegida pelos guards do renderer e do main).
 */
export function lockMainWindowForUninstall(): void {
  const w = uninstallWindowGetter?.()
  if (!w) return
  try {
    w.setClosable(false)
    w.setMinimizable(false)
  } catch {
    // Janela já destruída ou indisponível — sem ação.
  }
}

/** Restaura a janela (chame em TODA saída do fluxo: sucesso → spawn; erro; paused/choice). */
export function unlockMainWindowForUninstall(): void {
  const w = uninstallWindowGetter?.()
  if (!w) return
  try {
    w.setClosable(true)
    w.setMinimizable(true)
  } catch {
    // Janela já destruída (ex.: app encerrado pelo NSIS) — sem ação.
  }
}
