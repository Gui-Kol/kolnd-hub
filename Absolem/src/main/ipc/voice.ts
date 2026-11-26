import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { IpcError, VoiceStatusResult } from '../../shared/ipc'
import type { VoiceSetDeviceRequest } from '../../shared/voice'
import type { VoiceController } from '../voice/controller'

/**
 * Casca IPC da voz. Toda validação de payload acontece aqui; o controlador
 * recebe dados já normalizados. Os canais de áudio usam `ipcMain.on` (sem
 * resposta) para não bloquear o renderer.
 */

function failure(error: string): IpcError {
  return { ok: false, error }
}

function isVoidPayload(value: unknown): boolean {
  return value === undefined || value === null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function describe(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Aceita `Uint8Array`/Buffer/ArrayBuffer sem confiar no formato do transporte. */
function toBytes(payload: unknown): Uint8Array | null {
  if (payload instanceof Uint8Array) return payload
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload)
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
  }
  return null
}

export function registerVoiceIpc(controller: VoiceController): void {
  const voidAction = (channel: string, action: () => VoiceStatusResult) => {
    return (_event: unknown, payload: unknown): VoiceStatusResult => {
      if (!isVoidPayload(payload)) {
        return failure(`Payload inválido para ${channel}: ${describe(payload)}`)
      }
      try {
        return action()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return failure(`Falha em ${channel}: ${message}`)
      }
    }
  }

  ipcMain.handle(
    IPC.voiceStart,
    voidAction(IPC.voiceStart, () => statusFrom(controller.start()))
  )
  ipcMain.handle(
    IPC.voiceStop,
    voidAction(IPC.voiceStop, () => statusFrom(controller.stop()))
  )
  ipcMain.handle(
    IPC.voiceToggle,
    voidAction(IPC.voiceToggle, () => statusFrom(controller.toggle()))
  )
  ipcMain.handle(
    IPC.voiceStatus,
    voidAction(IPC.voiceStatus, () => ({ ok: true, status: controller.status() }))
  )
  ipcMain.handle(
    IPC.voiceInterrupt,
    voidAction(IPC.voiceInterrupt, () => statusFrom(controller.interrupt()))
  )

  ipcMain.handle(IPC.voiceSetConsent, (_event, payload: unknown): VoiceStatusResult => {
    if (!isRecord(payload) || typeof payload.granted !== 'boolean') {
      return failure(`Payload inválido para ${IPC.voiceSetConsent}.`)
    }
    try {
      const result = controller.setConsent(payload.granted)
      if (!result.ok) return failure(result.error ?? 'Falha ao salvar o consentimento.')
      return { ok: true, status: result.status }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return failure(`Falha em ${IPC.voiceSetConsent}: ${message}`)
    }
  })

  ipcMain.handle(IPC.voiceSetDevice, (_event, payload: unknown): VoiceStatusResult => {
    if (!isRecord(payload)) {
      return failure(`Payload inválido para ${IPC.voiceSetDevice}.`)
    }
    const allowed = new Set(['inputDeviceId', 'outputDeviceId'])
    for (const key of Object.keys(payload)) {
      if (!allowed.has(key)) {
        return failure(`Campo desconhecido em ${IPC.voiceSetDevice}: ${key}`)
      }
    }
    const request: VoiceSetDeviceRequest = {}
    if (payload.inputDeviceId !== undefined) {
      if (payload.inputDeviceId !== null && typeof payload.inputDeviceId !== 'string') {
        return failure(`Dispositivo de entrada inválido em ${IPC.voiceSetDevice}.`)
      }
      request.inputDeviceId = payload.inputDeviceId as string | null
    }
    if (payload.outputDeviceId !== undefined) {
      if (payload.outputDeviceId !== null && typeof payload.outputDeviceId !== 'string') {
        return failure(`Dispositivo de saída inválido em ${IPC.voiceSetDevice}.`)
      }
      request.outputDeviceId = payload.outputDeviceId as string | null
    }
    try {
      const result = controller.setDevice(request)
      if (!result.ok) return failure(result.error ?? 'Falha ao trocar o dispositivo.')
      return { ok: true, status: result.status }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return failure(`Falha em ${IPC.voiceSetDevice}: ${message}`)
    }
  })

  ipcMain.on(IPC.voiceAudioChunk, (_event, payload: unknown) => {
    controller.handleAudioChunk(toBytes(payload))
  })
  ipcMain.on(IPC.voiceBargeIn, (_event, payload: unknown) => {
    if (!isVoidPayload(payload)) return
    controller.handleBargeIn()
  })
  ipcMain.on(IPC.voiceSilence, (_event, payload: unknown) => {
    if (!isVoidPayload(payload)) return
    controller.handleSilence()
  })
}

function statusFrom(status: ReturnType<VoiceController['status']>): VoiceStatusResult {
  return { ok: true, status }
}
