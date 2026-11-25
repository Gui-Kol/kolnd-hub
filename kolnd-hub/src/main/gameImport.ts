import { ipcMain } from 'electron'
import type {
  GameImportReport,
  GameImportSourceId,
  GameSourceImportReport
} from '../shared/gameImport'
import { scanSteamGames } from './steamScanner'
import { scanEpicGames } from './epicScanner'
import { scanMinecraftLauncher } from './minecraftScanner'
import { logger } from './logger'

/**
 * Orquestrador da busca de jogos instalados ("Buscar jogos").
 *
 * Cada fonte roda em sequência e devolve seu próprio `GameSourceImportReport`;
 * uma falha inesperada em uma fonte NÃO aborta as demais — o erro fica isolado
 * no relatório daquela fonte. O `imported` do relatório geral é a soma.
 *
 * A lista de fontes é injetável para testes; em produção inclui Steam, Epic
 * Games e Minecraft Launcher.
 */

/** Uma fonte de jogos: identidade fixa + varredura (que já trata erros por jogo). */
export interface GameImportSource {
  id: GameImportSourceId
  label: string
  scan: () => Promise<GameSourceImportReport>
}

/** Fontes habilitadas no app. */
const DEFAULT_SOURCES: GameImportSource[] = [
  { id: 'steam', label: 'Steam', scan: scanSteamGames },
  { id: 'epic', label: 'Epic Games', scan: scanEpicGames },
  { id: 'minecraft', label: 'Minecraft Launcher', scan: scanMinecraftLauncher }
]

/** Relatório de uma fonte que lançou: mantém a identidade e isola a falha. */
function failedSourceReport(source: GameImportSource, error: unknown): GameSourceImportReport {
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'Ocorreu um erro inesperado ao procurar os jogos.'
  return {
    source: source.id,
    label: source.label,
    // detected continua true: a fonte existe, mas a varredura falhou (não é "não encontrado").
    detected: true,
    imported: 0,
    alreadyInLibrary: 0,
    ignored: 0,
    noExe: 0,
    errors: [message],
    message: `Não foi possível buscar os jogos de ${source.label}.`
  }
}

/** Executa todas as fontes em sequência e devolve o relatório agregado. */
export async function importGamesFromAllSources(
  sources: GameImportSource[] = DEFAULT_SOURCES
): Promise<GameImportReport> {
  const reports: GameSourceImportReport[] = []

  for (const source of sources) {
    try {
      reports.push(await source.scan())
    } catch (err) {
      // Uma fonte quebrada nunca impede as próximas de rodar.
      logger.error('game-import', `Falha ao buscar jogos de ${source.label}:`, err)
      reports.push(failedSourceReport(source, err))
    }
  }

  const imported = reports.reduce((total, report) => total + report.imported, 0)
  logger.info(
    'game-import',
    `Busca concluída: ${imported} jogo(s) adicionado(s) em ${reports.length} fonte(s)`
  )

  return { ok: true, sources: reports, imported }
}

/** Registra o canal IPC único da busca ("Buscar jogos"). */
export function registerGameImportIpc(): void {
  ipcMain.handle('games:import-all', (): Promise<GameImportReport> => importGamesFromAllSources())
}
