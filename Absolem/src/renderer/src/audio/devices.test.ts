import { describe, expect, it, vi } from 'vitest'
import {
  createDeviceWatcher,
  listAudioDevices,
  planDeviceChange,
  type DeviceSelection,
  type MediaDeviceInfoLike,
  type MediaDevicesLike
} from './devices'

function mediaDevices(devices: MediaDeviceInfoLike[]) {
  const listeners = new Set<() => void>()
  const api: MediaDevicesLike & { fire: () => void } = {
    enumerateDevices: async () => devices,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    fire: () => {
      for (const listener of listeners) listener()
    }
  }
  return api
}

describe('dispositivos de áudio', () => {
  it('lista sem rótulos vazios', async () => {
    const api = mediaDevices([
      { deviceId: 'mic-1', kind: 'audioinput', label: '  ' },
      { deviceId: 'mic-2', kind: 'audioinput', label: 'Fone USB' },
      { deviceId: 'out-1', kind: 'audiooutput', label: '' },
      { deviceId: '', kind: 'audioinput', label: 'inválido' },
      { deviceId: 'cam-1', kind: 'videoinput', label: 'Câmera' }
    ])

    const lists = await listAudioDevices(api)

    expect(lists.inputs).toEqual([
      { id: 'mic-1', label: 'Microfone 1' },
      { id: 'mic-2', label: 'Fone USB' }
    ])
    expect(lists.outputs).toEqual([{ id: 'out-1', label: 'Saída de áudio 1' }])
  })

  it('dispositivo removido cai no default', async () => {
    let devices: MediaDeviceInfoLike[] = [
      { deviceId: 'mic-1', kind: 'audioinput', label: 'Mic 1' },
      { deviceId: 'out-1', kind: 'audiooutput', label: 'Saída 1' }
    ]
    const api = mediaDevices(devices)
    const lost = vi.fn()
    let selection: DeviceSelection = { inputDeviceId: 'mic-1', outputDeviceId: 'out-1' }
    const watcher = createDeviceWatcher({
      mediaDevices: api,
      getSelection: () => selection,
      onSelectionLost: (kind, next) => {
        lost(kind, next)
        selection = next
      }
    })

    await watcher.refresh()
    expect(lost).not.toHaveBeenCalled()

    devices = [{ deviceId: 'out-1', kind: 'audiooutput', label: 'Saída 1' }]
    api.enumerateDevices = async () => devices
    await watcher.refresh()

    expect(lost).toHaveBeenCalledWith('input', {
      inputDeviceId: null,
      outputDeviceId: 'out-1'
    })
    watcher.stop()
  })

  it('troca encerra sessão', () => {
    const lists = {
      inputs: [{ id: 'mic-1', label: 'Mic 1' }],
      outputs: [{ id: 'out-1', label: 'Saída 1' }]
    }
    const plan = planDeviceChange({ inputDeviceId: 'mic-2', outputDeviceId: 'out-1' }, lists, true)
    expect(plan.lost).toEqual(['input'])
    expect(plan.next).toEqual({ inputDeviceId: null, outputDeviceId: 'out-1' })
    expect(plan.endSession).toBe(true)

    // Sessão já encerrada: a troca só atualiza a preferência.
    expect(
      planDeviceChange({ inputDeviceId: 'mic-2', outputDeviceId: 'out-1' }, lists, false).endSession
    ).toBe(false)
  })
})
