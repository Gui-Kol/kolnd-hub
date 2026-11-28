import {
  FPS_MAX_PROCESS_NAME_LENGTH,
  fpsReadingWithReason,
  type FpsPidSample,
  type FpsSink,
  type HudFpsReading
} from '../../shared/fps'
import { buildLiveReading } from './aggregate'

/**
 * Seleção do alvo: SOMENTE o app em primeiro plano (D3).
 *
 * O sink traz presents de todos os apps; escolher "o que mais apresenta" seria
 * mostrar o FPS de um jogo em segundo plano. Se o primeiro plano é o próprio
 * Hub/Explorer/DWM, o resultado é `no-target` com motivo — nunca um PID de
 * segundo plano. O único fallback aceito é o MESMO executável do app em foco
 * (apps multi-processo, ex.: Chromium/jogo com processo de apresentação).
 */

const IGNORED_PROCESS_NAMES = [
  'electron',
  'kolnd hub',
  'explorer',
  'dwm',
  'searchhost',
  'startmenuexperiencehost',
  'shellexperiencehost',
  'textinputhost',
  'lockapp'
] as const

function normalizeProcessName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null
  let value = name.trim().toLowerCase()
  if (!value) return null
  if (value.endsWith('.exe')) value = value.slice(0, -4)
  return value || null
}

/** `true` para processos que nunca são um alvo de FPS (Hub, shell, DWM). */
export function isIgnoredProcess(name: string | null | undefined): boolean {
  const normalized = normalizeProcessName(name)
  return normalized !== null && (IGNORED_PROCESS_NAMES as readonly string[]).includes(normalized)
}

/** Nome exibido no HUD: sem o sufixo `.exe`, sem espaços nas pontas. */
export function displayProcessName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null
  let value = name.trim()
  if (!value) return null
  if (value.toLowerCase().endsWith('.exe')) value = value.slice(0, -4)
  value = value.trim()
  if (!value) return null
  return value.slice(0, FPS_MAX_PROCESS_NAME_LENGTH)
}

export interface FpsTargetOptions {
  /** PID do processo principal do Hub (window owner). */
  selfPid: number
}

function sameName(a: string, b: string): boolean {
  const left = normalizeProcessName(a)
  const right = normalizeProcessName(b)
  return left !== null && right !== null && left === right
}

function liveFrom(sample: FpsPidSample, sink: FpsSink): HudFpsReading | null {
  const name = displayProcessName(sample.name) ?? displayProcessName(sink.foregroundName)
  if (!name) return null
  return buildLiveReading(sample, sink.windowMs, name)
}

/**
 * Decide a leitura a partir de um sink fresco. Nunca lança; qualquer entrada
 * inconsistente termina em `no-target`/`no-presents` sem número.
 */
export function selectFpsTarget(sink: FpsSink, options: FpsTargetOptions): HudFpsReading {
  const foregroundPid = sink.foregroundPid
  const foregroundName = sink.foregroundName

  // O Hub em foco: instrução para abrir o jogo, nunca o FPS do próprio Hub.
  if (foregroundPid !== null && foregroundPid === options.selfPid) {
    return fpsReadingWithReason('no-target', 'self-focus')
  }
  if (isIgnoredProcess(foregroundName)) {
    return fpsReadingWithReason('no-target', 'foreground-ignored')
  }
  if (foregroundPid === null || foregroundPid <= 0) {
    return fpsReadingWithReason('no-target', 'no-foreground')
  }

  const direct = sink.pids.find((sample) => sample.pid === foregroundPid)
  if (direct && direct.presents > 0) {
    const reading = liveFrom(direct, sink)
    if (reading) return reading
  }

  // Mesmo executável do app em foco (multi-processo). Só aqui — jamais outro
  // processo qualquer em segundo plano.
  if (foregroundName) {
    const sameApp = sink.pids
      .filter((sample) => sample.presents > 0 && sameName(sample.name, foregroundName))
      .sort((a, b) => b.presents - a.presents)[0]
    if (sameApp) {
      const reading = liveFrom(sameApp, sink)
      if (reading) return reading
    }
  }

  return fpsReadingWithReason('no-presents', 'no-presents')
}
