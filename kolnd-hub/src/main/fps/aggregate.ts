import { FPS_MAX_FPS, FPS_MAX_FRAMETIME_MS, type HudFpsReading } from '../../shared/fps'
import type { FpsPidSample } from '../../shared/fps'

/**
 * Cálculo do FPS de uma amostra.
 *
 * A janela é fixa (1 s) e o agente conta presents nela; `fps = presents /
 * (windowMs/1000)`. Sanidade: `0 < fps <= 1000` e `0 < frametime <= 1000`.
 * Fora disso a amostra vira `no-presents` no alvo — nunca um número absurdo.
 */

export function computeFps(presents: unknown, windowMs: unknown): number | null {
  if (typeof presents !== 'number' || !Number.isFinite(presents) || presents <= 0) return null
  if (typeof windowMs !== 'number' || !Number.isFinite(windowMs) || windowMs <= 0) return null
  const fps = presents / (windowMs / 1000)
  if (!Number.isFinite(fps) || fps <= 0 || fps > FPS_MAX_FPS) return null
  // Uma casa decimal é o suficiente para a UI e evita ruído de float.
  return Math.round(fps * 10) / 10
}

export function normalizeFrametime(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value <= 0 || value > FPS_MAX_FRAMETIME_MS) return null
  return Math.round(value * 100) / 100
}

/**
 * Monta a leitura `live` de uma amostra. Nome vazio/inválido, fps ou frametime
 * fora da faixa = `null` (o chamador decide o motivo, nunca inventa número).
 */
export function buildLiveReading(
  sample: FpsPidSample,
  windowMs: number,
  processName: string
): HudFpsReading | null {
  const fps = computeFps(sample.presents, windowMs)
  const frametimeMs = normalizeFrametime(sample.frametimeMs)
  const name = processName.trim()
  if (fps === null || frametimeMs === null || !name) return null
  return { state: 'live', fps, frametimeMs, processName: name }
}
