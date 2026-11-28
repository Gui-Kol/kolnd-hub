/**
 * Exportar/importar a configuração do Hub (07-7.6): backup manual em 1 clique.
 *
 * O arquivo exportado é um JSON com tudo o que o usuário configurou
 * (apps completos — inclusive command/cwd, biblioteca de jogos, importação
 * do startup, prefs do Big Picture e controle) para levar de uma máquina
 * para outra. NÃO inclui logs, ícones de jogos, first-run-flag nem dados
 * internos dos programas gerenciados (chaves e memórias vivem fora do config.json).
 *
 * Import é SUBSTITUIÇÃO com backup prévio (feito pelo IPC antes de aplicar),
 * nunca merge. Seções ausentes no arquivo são toleradas (o valor atual
 * permanece); seções presentes mas inválidas são recusadas individualmente,
 * sem derrubar as demais.
 */
import {
  getConfigSnapshot,
  getStoredGames,
  getLaunchKloudOnStart,
  getBigPicturePrefs,
  getGamepadConfig,
  setApps,
  setStartupImportance,
  setStoredGames,
  setLaunchKloudOnStart,
  setBigPicturePrefs,
  setGamepadConfig,
  resetGamepadConfig,
  normalizeAppConfigs,
  normalizeStartupImportance,
  normalizeGames,
  normalizeGamepadConfig,
  type StoredAppConfig,
  type StoredGame,
  type ImportanceLevelName,
  type BigPicturePrefs
} from './store'
import type { GamepadConfig } from '../shared/gamepad'
import { logger } from './logger'

// ── Tipos ────────────────────────────────────────────────────────

export interface HubConfigExportData {
  apps: StoredAppConfig[]
  startupImportance: Record<string, ImportanceLevelName>
  games: StoredGame[]
  launchKloudOnStart: boolean
  bigPicture: BigPicturePrefs
  gamepad: GamepadConfig | null
}

export interface HubConfigExport {
  app: 'kolnd-hub'
  version: 1
  exportedAt: string
  data: HubConfigExportData
}

/**
 * Seções normalizadas prontas para aplicar. Chaves ausentes = seção ausente
 * no arquivo (tolerada; o valor atual permanece no store).
 */
export interface NormalizedImportData {
  apps?: StoredAppConfig[]
  startupImportance?: Record<string, ImportanceLevelName>
  games?: StoredGame[]
  launchKloudOnStart?: boolean
  bigPicture?: BigPicturePrefs
  /** `null` explícito = "sem controle configurado" (o apply reseta a chave). */
  gamepad?: GamepadConfig | null
}

export interface RejectedSection {
  section: string
  error: string
}

export type ValidateImportResult =
  | { ok: true; data: NormalizedImportData; rejected: RejectedSection[] }
  | { ok: false; errors: string[] }

export interface ImportApplyReport {
  /** Chaves das seções aplicadas com sucesso. */
  applied: string[]
  /** Seções que falharam — as demais seguiram. */
  failed: Array<{ section: string; error: string }>
}

export interface ImportSummary {
  apps: number
  games: number
  /** Chaves das seções presentes e válidas no arquivo. */
  sections: string[]
}

// ── Export ───────────────────────────────────────────────────────

/** Monta o objeto de exportação a partir do store (getters existentes). */
export function buildExport(): HubConfigExport {
  const snapshot = getConfigSnapshot()
  return {
    app: 'kolnd-hub',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      // Snapshot devolve null quando nunca salvo/vazio — o backup usa [].
      apps: snapshot.apps ?? [],
      startupImportance: snapshot.startupImportance ?? {},
      games: getStoredGames(),
      launchKloudOnStart: getLaunchKloudOnStart(),
      bigPicture: getBigPicturePrefs(),
      gamepad: getGamepadConfig()
    }
  }
}

/** Resumo para a confirmação do import: o que será substituído. */
export function summarizeImport(data: NormalizedImportData): ImportSummary {
  return {
    apps: data.apps?.length ?? 0,
    games: data.games?.length ?? 0,
    sections: Object.keys(data)
  }
}

// ── Import: validação ────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Valida a estrutura do arquivo e normaliza cada seção.
 *
 * Fatal (`ok: false`): JSON estrutural inválido, `app` ≠ 'kolnd-hub' ou
 * `version` ≠ 1 — nada é aplicado.
 *
 * Não fatal: seção presente mas inválida → a seção é recusada em
 * `rejected` e as demais são aplicadas normalmente (forward-compat:
 * campos/seções desconhecidos são ignorados).
 */
export function validateImport(raw: unknown): ValidateImportResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['O arquivo não contém um objeto de configuração válido.'] }
  }
  if (raw.app !== 'kolnd-hub') {
    return { ok: false, errors: ['O arquivo não é um backup do Kolnd Hub (campo "app" inválido).'] }
  }
  if (raw.version !== 1) {
    return { ok: false, errors: ['Versão de backup não suportada (esperado "version": 1).'] }
  }

  const rawData = raw.data
  if (rawData !== undefined && !isPlainObject(rawData)) {
    return { ok: false, errors: ['Seção "data" inválida no arquivo de backup.'] }
  }

  const data: NormalizedImportData = {}
  const rejected: RejectedSection[] = []
  // Campos futuros/desconhecidos dentro de `data` são tolerados e ignorados.
  const d = (rawData ?? {}) as Record<string, unknown>

  if ('apps' in d) {
    if (Array.isArray(d.apps)) data.apps = normalizeAppConfigs(d.apps)
    else rejected.push({ section: 'apps', error: '"apps" deve ser uma lista.' })
  }
  if ('startupImportance' in d) {
    if (isPlainObject(d.startupImportance)) {
      data.startupImportance = normalizeStartupImportance(d.startupImportance)
    } else {
      rejected.push({
        section: 'startupImportance',
        error: '"startupImportance" deve ser um objeto.'
      })
    }
  }
  if ('games' in d) {
    if (Array.isArray(d.games)) data.games = normalizeGames(d.games)
    else rejected.push({ section: 'games', error: '"games" deve ser uma lista.' })
  }
  if ('launchKloudOnStart' in d) {
    if (typeof d.launchKloudOnStart === 'boolean') data.launchKloudOnStart = d.launchKloudOnStart
    else
      rejected.push({
        section: 'launchKloudOnStart',
        error: '"launchKloudOnStart" deve ser booleano.'
      })
  }
  if ('bigPicture' in d) {
    const value = d.bigPicture
    if (!isPlainObject(value)) {
      rejected.push({ section: 'bigPicture', error: '"bigPicture" deve ser um objeto.' })
    } else {
      const sounds = value.sounds
      if (sounds === undefined) data.bigPicture = { sounds: true }
      else if (typeof sounds === 'boolean') data.bigPicture = { sounds }
      else rejected.push({ section: 'bigPicture', error: '"bigPicture.sounds" deve ser booleano.' })
    }
  }
  if ('gamepad' in d) {
    const value = d.gamepad
    // `null` explícito = "sem controle configurado" — aplica como reset.
    if (value === null) data.gamepad = null
    else {
      const normalized = normalizeGamepadConfig(value)
      if (normalized) data.gamepad = normalized
      else rejected.push({ section: 'gamepad', error: 'Configuração de controle inválida.' })
    }
  }

  return { ok: true, data, rejected }
}

// ── Import: aplicação ────────────────────────────────────────────

/**
 * Aplica as seções presentes em `data`, uma a uma (ordem: apps → games →
 * prefs → gamepad). Uma seção que falha não derruba as outras — o relatório
 * lista o que foi aplicado e o que falhou.
 */
export function applyImport(data: NormalizedImportData): ImportApplyReport {
  const applied: string[] = []
  const failed: Array<{ section: string; error: string }> = []

  const applySection = (section: string, fn: () => { success: boolean; error?: string }): void => {
    try {
      const result = fn()
      if (result.success) applied.push(section)
      else failed.push({ section, error: result.error ?? 'Erro desconhecido.' })
    } catch (err) {
      failed.push({ section, error: err instanceof Error ? err.message : String(err) })
    }
  }

  if (data.apps !== undefined) applySection('apps', () => setApps(data.apps))
  if (data.startupImportance !== undefined) {
    applySection('startupImportance', () => setStartupImportance(data.startupImportance))
  }
  if (data.games !== undefined) applySection('games', () => setStoredGames(data.games))
  if (data.launchKloudOnStart !== undefined) {
    applySection('launchKloudOnStart', () => setLaunchKloudOnStart(data.launchKloudOnStart))
  }
  if (data.bigPicture !== undefined) {
    applySection('bigPicture', () => setBigPicturePrefs(data.bigPicture))
  }
  if (data.gamepad !== undefined) {
    // null explícito = restaurar "sem controle configurado".
    if (data.gamepad === null) applySection('gamepad', () => resetGamepadConfig())
    else applySection('gamepad', () => setGamepadConfig(data.gamepad))
  }

  logger.info(
    'configTransfer',
    `Importação aplicada: ${applied.length} seção(ões) ok, ${failed.length} com falha` +
      (failed.length > 0 ? ` (${failed.map((f) => f.section).join(', ')})` : '')
  )
  return { applied, failed }
}
