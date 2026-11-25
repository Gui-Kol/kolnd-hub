/**
 * Contratos da busca automática de jogos instalados (Steam, Epic Games e
 * Minecraft Launcher). Só tipos: o arquivo é compartilhado entre main e
 * renderer sem lógica executável, por isso fica fora da medição de cobertura.
 */

export type GameImportSourceId = 'steam' | 'epic' | 'minecraft'

/** Resultado da varredura de UMA fonte (Steam, Epic Games ou Minecraft Launcher). */
export interface GameSourceImportReport {
  source: GameImportSourceId
  /** Nome exibido na UI: 'Steam' | 'Epic Games' | 'Minecraft Launcher'. */
  label: string
  /** false = a loja/launcher não está instalado neste PC (não é erro). */
  detected: boolean
  /** Jogos efetivamente adicionados à biblioteca nesta busca. */
  imported: number
  /** Jogos detectados que já estavam na biblioteca — reimportar não duplica. */
  alreadyInLibrary: number
  /** Ferramentas, DLCs, manifests inválidos e duplicatas descartadas de propósito. */
  ignored: number
  /** Jogos válidos cujo executável não foi localizado. */
  noExe: number
  /** Falhas por jogo — nunca abortam a busca das demais entradas. */
  errors: string[]
  /** Mensagem amigável quando `detected` é false (ou aviso específico da fonte). */
  message?: string
}

/** Relatório único devolvido pela busca em todas as fontes (`games:import-all`). */
export interface GameImportReport {
  ok: boolean
  sources: GameSourceImportReport[]
  /** Soma de `imported` de todas as fontes. */
  imported: number
  /** Falha inesperada no orquestrador (as falhas por fonte ficam em `sources`). */
  error?: string
}
