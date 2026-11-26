import { promises as fs } from 'fs'
import {
  FPS_MAX_FRAMETIME_MS,
  FPS_MAX_PIDS,
  FPS_MAX_PROCESS_NAME_LENGTH,
  FPS_MAX_SINK_BYTES,
  FPS_SINK_STALE_MS,
  type FpsPidSample,
  type FpsSink
} from '../../shared/fps'

/**
 * Leitor do `latest.json` publicado pelo agente elevado.
 *
 * O arquivo fica em `%ProgramData%\Kolnd Hub\capture`, legível por Usuários:
 * é ENTRADA NÃO CONFIÁVEL. Validamos schema, tipos, faixas, tamanho (≤ 64 KB),
 * quantidade de PIDs e a idade do timestamp. Qualquer coisa inválida =
 * `fresh: false`; o main nunca deriva número de um JSON meio válido.
 */

export interface ParsedFpsSink {
  /** Arquivo válido e com timestamp recente (≤ 3 s). */
  fresh: boolean
  /** Arquivo válido, mas velho — a captura parou. */
  stale: boolean
  sink: FpsSink | null
}

const EMPTY: ParsedFpsSink = { fresh: false, stale: false, sink: null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || name.length > FPS_MAX_PROCESS_NAME_LENGTH) return null
  for (let index = 0; index < name.length; index++) {
    const code = name.charCodeAt(index)
    if (code < 32 || code === 127) return null
  }
  return name
}

function toPid(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null
  return value <= 0xffff_ffff ? value : null
}

function parseSamples(raw: unknown): FpsPidSample[] {
  if (!Array.isArray(raw)) return []
  const samples: FpsPidSample[] = []
  for (const entry of raw.slice(0, FPS_MAX_PIDS * 2)) {
    if (!isRecord(entry)) continue
    const pid = toPid(entry.pid)
    const name = cleanName(entry.name)
    const presents = finite(entry.presents)
    const frametimeMs = finite(entry.frametimeMs)
    if (pid === null || name === null || presents === null || frametimeMs === null) continue
    if (presents < 0 || presents > 10_000_000) continue
    if (frametimeMs < 0 || frametimeMs > FPS_MAX_FRAMETIME_MS) continue
    samples.push({ pid, name, presents, frametimeMs })
    if (samples.length >= FPS_MAX_PIDS) break
  }
  return samples
}

/**
 * Valida um objeto já parseado. `nowMs` é injetado para o teste ser
 * determinístico; idade no futuro além de 5 s é rejeitada (clock errado).
 */
export function parseFpsSink(input: unknown, nowMs: number): ParsedFpsSink {
  if (!isRecord(input)) return EMPTY
  if (input.schema !== 2) return EMPTY
  if (!isRecord(input.engine) || input.engine.name !== 'PresentMon') return EMPTY
  if (typeof input.engine.version !== 'string' || !input.engine.version.trim()) return EMPTY
  if (typeof input.timestamp !== 'string') return EMPTY
  const stamp = Date.parse(input.timestamp)
  if (!Number.isFinite(stamp)) return EMPTY

  const windowMs = finite(input.windowMs)
  if (windowMs === null || windowMs <= 0 || windowMs > 5_000) return EMPTY

  const foregroundPid = input.foregroundPid === null ? null : toPid(input.foregroundPid)
  if (input.foregroundPid !== null && foregroundPid === null) return EMPTY
  const foregroundName = input.foregroundName === null ? null : cleanName(input.foregroundName)
  if (input.foregroundName !== null && foregroundName === null) return EMPTY
  if (!Array.isArray(input.pids)) return EMPTY

  const sink: FpsSink = {
    schema: 2,
    engine: { name: 'PresentMon', version: input.engine.version },
    timestamp: input.timestamp,
    foregroundPid,
    foregroundName,
    windowMs,
    pids: parseSamples(input.pids)
  }

  const age = nowMs - stamp
  if (age < -5_000) return EMPTY
  if (age > FPS_SINK_STALE_MS) return { fresh: false, stale: true, sink: null }
  return { fresh: true, stale: false, sink }
}

/** Lê e valida o arquivo; ausente/ilegível/tamanho absurdo = inválido. */
export async function readFpsSinkFile(path: string, nowMs: number): Promise<ParsedFpsSink> {
  try {
    const stat = await fs.stat(path)
    if (!stat.isFile() || stat.size <= 0 || stat.size > FPS_MAX_SINK_BYTES) return EMPTY
    const text = (await fs.readFile(path, 'utf8')).replace(/^\uFEFF/, '')
    return parseFpsSink(JSON.parse(text) as unknown, nowMs)
  } catch {
    return EMPTY
  }
}
