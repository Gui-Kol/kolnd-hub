import { ipcMain } from 'electron'
import { registerProcessConsumer, startProcessWatch } from '../processWatch'
import type { IpcContext } from './lifecycle'

/* faixa aceita pelo renderer: 4 s (Big Picture/Biblioteca) a 2 min (bandeja) */
const MIN_INTERVAL_MS = 4000
const MAX_INTERVAL_MS = 120000
const MAX_ID_LENGTH = 64
const ID_PATTERN = /^[a-z0-9:_-]{1,64}$/

/** Unsubscribe por consumidor; `registerProcessConsumer` é idempotente por id. */
const subscriptions = new Map<string, () => void>()

function assertArity(args: unknown[]): void {
  if (args.length !== 2) {
    throw new Error('argumentos inválidos: esperado exatamente o evento e o payload')
  }
}

function readPayload(payload: unknown, keys: string[]): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('payload inválido: esperado um objeto')
  }
  const actual = Object.keys(payload)
  if (actual.length !== keys.length || !keys.every((key) => actual.includes(key))) {
    throw new Error(`payload inválido: campos esperados ${keys.join(', ')}`)
  }
  return payload as Record<string, unknown>
}

function readId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_ID_LENGTH ||
    !ID_PATTERN.test(value)
  ) {
    throw new Error('id inválido: use 1 a 64 caracteres (a-z, 0-9, :, _, -)')
  }
  return value
}

function readInterval(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_INTERVAL_MS ||
    value > MAX_INTERVAL_MS
  ) {
    throw new Error('intervalMs inválido: use um inteiro entre 4000 e 120000')
  }
  return value
}

export function registerProcessWatchIpc(ctx: IpcContext): void {
  // O agendador empurra o resultado para a janela principal; só existe timer
  // quando algum consumidor do renderer assina.
  startProcessWatch(ctx)

  ipcMain.handle('process-watch:start', (...args: unknown[]) => {
    assertArity(args)
    const payload = readPayload(args[1], ['id', 'intervalMs'])
    const id = readId(payload.id)
    const intervalMs = readInterval(payload.intervalMs)

    // Re-registrar o mesmo id atualiza o intervalo (o token antigo do
    // unsubscribe fica inerte dentro do processWatch).
    subscriptions.set(id, registerProcessConsumer(id, intervalMs))
    return { ok: true }
  })

  ipcMain.handle('process-watch:stop', (...args: unknown[]) => {
    assertArity(args)
    const payload = readPayload(args[1], ['id'])
    const id = readId(payload.id)

    subscriptions.get(id)?.()
    subscriptions.delete(id)
    return { ok: true }
  })
}
