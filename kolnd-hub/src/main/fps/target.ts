import type { FpsInactiveReason } from '../../shared/fps'
import type { FpsHelperSample } from './helper'

/**
 * Processos que nunca são o alvo da medição: são cascas do sistema (ou do
 * próprio Hub), não o jogo/app que o usuário quer medir. Sem isso, manter o
 * Monitor aberto em primeiro plano mediria o Chromium do Hub — e o Explorer/DWM
 * apresentam continuamente em segundo plano. A lista é comparada em minúsculas
 * e com sufixo `.exe` normalizado.
 */
export const IGNORED_PROCESS_NAMES = [
  'explorer.exe',
  'dwm.exe',
  'electron.exe',
  'searchhost.exe',
  'startmenuexperiencehost.exe',
  'shellexperiencehost.exe',
  'textinputhost.exe',
  'lockapp.exe'
]

function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return true
  }
  return false
}

/** Nome "de vitrine": o helper devolve `ProcessName` sem `.exe`. */
export function displayProcessName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null
  const base = name.trim().split(/[\\/]/).pop()?.trim() ?? ''
  if (!base || base.length > 260) return null
  if (hasControlChars(base)) return null
  return /\.exe$/i.test(base) ? base : `${base}.exe`
}

function comparisonName(name: string | null | undefined): string | null {
  return displayProcessName(name)?.toLowerCase() ?? null
}

export function isIgnoredProcess(
  name: string | null | undefined,
  extraIgnored: readonly string[] = []
): boolean {
  const normalized = comparisonName(name)
  if (!normalized) return true
  const ignored = new Set(
    [...IGNORED_PROCESS_NAMES, ...extraIgnored]
      .map((item) => comparisonName(item))
      .filter((item): item is string => item !== null)
  )
  return ignored.has(normalized)
}

export interface FpsTarget {
  pid: number
  processName: string
  fps: number
  frametimeMs: number
}

export interface FpsTargetResult {
  target: FpsTarget | null
  /** Motivo do "—" quando não há alvo; `null` quando o alvo foi medido. */
  reason: FpsInactiveReason | null
}

/**
 * Escolhe o alvo da amostra: o processo da **janela em primeiro plano** (o
 * helper informa o PID do SO) que tenha apresentado quadros nesta janela.
 * Se o primeiro plano é ignorado, não existe alvo — devolvemos o motivo em
 * vez de reaproveitar o último jogo visto (o card diria "ao vivo" mentindo).
 */
export function selectFpsTarget(
  sample: FpsHelperSample,
  extraIgnored: readonly string[] = []
): FpsTargetResult {
  const foregroundPid = sample.foregroundPid
  if (!foregroundPid) return { target: null, reason: 'no-target' }

  const foregroundName = displayProcessName(sample.foregroundName)
  if (!foregroundName || isIgnoredProcess(foregroundName, extraIgnored)) {
    return { target: null, reason: 'no-target' }
  }

  let entry = sample.pids.find((item) => item.pid === foregroundPid)

  // Apps multi-processo (Chromium/Electron) apresentam no processo gráfico, não
  // no processo dono da janela. Quando o PID do primeiro plano não tem presents,
  // aceitamos o PID com o MESMO executável e mais presents — continua sendo o
  // app em primeiro plano, só que a apresentação vive no filho GPU.
  if (!entry) {
    const sameExe = sample.pids
      .filter((item) => comparisonName(item.name) === comparisonName(foregroundName))
      .sort((left, right) => right.presents - left.presents)
    entry = sameExe[0]
  }

  if (!entry || entry.presents <= 0 || entry.fps <= 0) {
    return { target: null, reason: 'no-presents' }
  }

  return {
    target: {
      pid: entry.pid,
      processName: displayProcessName(entry.name ?? sample.foregroundName) ?? `pid ${entry.pid}`,
      fps: entry.fps,
      frametimeMs: entry.frametimeMs
    },
    reason: null
  }
}
