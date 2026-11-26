/**
 * Seleção de dispositivos de áudio (task 06).
 *
 * - lista microfones e saídas com rótulo nunca vazio (fallback numerado);
 * - `devicechange`: se o dispositivo escolhido sumiu, avisa o chamador para
 *   persistir o default e encerrar a sessão;
 * - nunca troca de dispositivo no meio de uma fala: o controlador do main
 *   encerra a sessão antes de persistir a troca.
 *
 * `navigator.mediaDevices` é injetado para teste em Node.
 */

export interface MediaDeviceInfoLike {
  deviceId: string
  kind: string
  label: string
  groupId?: string
}

export interface MediaDevicesLike {
  enumerateDevices: () => Promise<MediaDeviceInfoLike[]>
  addEventListener?: (type: 'devicechange', listener: () => void) => void
  removeEventListener?: (type: 'devicechange', listener: () => void) => void
}

export interface AudioDevice {
  id: string
  label: string
}

export interface AudioDeviceLists {
  inputs: AudioDevice[]
  outputs: AudioDevice[]
}

export interface DeviceSelection {
  inputDeviceId: string | null
  outputDeviceId: string | null
}

export interface DeviceWatcherOptions {
  mediaDevices: MediaDevicesLike
  getSelection: () => DeviceSelection
  /** Chamado uma vez por dispositivo removido, já com o default calculado. */
  onSelectionLost: (kind: 'input' | 'output', next: DeviceSelection) => void
  onError?: (error: unknown) => void
}

export interface DeviceWatcher {
  refresh: () => Promise<AudioDeviceLists>
  stop: () => void
}

export function fallbackLabel(kind: 'input' | 'output', index: number): string {
  return kind === 'input' ? `Microfone ${index + 1}` : `Saída de áudio ${index + 1}`
}

function cleanLabel(value: unknown, kind: 'input' | 'output', index: number): string {
  const label = typeof value === 'string' ? value.trim() : ''
  return label.length > 0 ? label : fallbackLabel(kind, index)
}

/** Lista microfones e saídas; dispositivo sem `deviceId` é ignorado. */
export async function listAudioDevices(mediaDevices: MediaDevicesLike): Promise<AudioDeviceLists> {
  const devices = await mediaDevices.enumerateDevices()
  const inputs: AudioDevice[] = []
  const outputs: AudioDevice[] = []
  for (const device of devices) {
    if (typeof device.deviceId !== 'string' || device.deviceId.length === 0) continue
    if (device.kind === 'audioinput') {
      inputs.push({ id: device.deviceId, label: cleanLabel(device.label, 'input', inputs.length) })
    } else if (device.kind === 'audiooutput') {
      outputs.push({
        id: device.deviceId,
        label: cleanLabel(device.label, 'output', outputs.length)
      })
    }
  }
  return { inputs, outputs }
}

function isMissing(id: string | null, devices: AudioDevice[]): boolean {
  return typeof id === 'string' && id.length > 0 && !devices.some((device) => device.id === id)
}

export interface DeviceChangePlan {
  next: DeviceSelection
  lost: Array<'input' | 'output'>
  /** Sessão ativa + dispositivo removido: o main precisa encerrar antes. */
  endSession: boolean
}

/**
 * Calcula o efeito de uma troca de dispositivos. Puro para o controlador e o
 * watcher compartilharem a mesma regra: sessão ativa com dispositivo removido
 * termina antes de qualquer troca (nunca no meio de uma fala).
 */
export function planDeviceChange(
  current: DeviceSelection,
  lists: AudioDeviceLists,
  sessionActive: boolean
): DeviceChangePlan {
  const lost: Array<'input' | 'output'> = []
  const next: DeviceSelection = { ...current }
  if (isMissing(current.inputDeviceId, lists.inputs)) {
    lost.push('input')
    next.inputDeviceId = null
  }
  if (isMissing(current.outputDeviceId, lists.outputs)) {
    lost.push('output')
    next.outputDeviceId = null
  }
  return { next, lost, endSession: sessionActive && lost.length > 0 }
}

export function createDeviceWatcher(options: DeviceWatcherOptions): DeviceWatcher {
  let stopped = false

  const refresh = async (): Promise<AudioDeviceLists> => {
    const lists = await listAudioDevices(options.mediaDevices)
    if (stopped) return lists
    const plan = planDeviceChange(options.getSelection(), lists, false)
    for (const kind of plan.lost) {
      options.onSelectionLost(kind, plan.next)
    }
    return lists
  }

  const onChange = (): void => {
    void refresh().catch((err: unknown) => options.onError?.(err))
  }

  options.mediaDevices.addEventListener?.('devicechange', onChange)
  return {
    refresh,
    stop: () => {
      if (stopped) return
      stopped = true
      options.mediaDevices.removeEventListener?.('devicechange', onChange)
    }
  }
}
