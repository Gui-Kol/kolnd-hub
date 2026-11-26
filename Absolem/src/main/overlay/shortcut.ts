import { app, globalShortcut } from 'electron'
import { logger } from '../logger'
import { normalizeAccelerator, OVERLAY_DEFAULT_SHORTCUT } from '../../shared/overlay'

/** Estado do atalho exposto no `overlay:status` para a UI. */
export interface ShortcutStatus {
  registered: boolean
  accelerator: string
}

/** Subconjunto de `Electron.GlobalShortcut` (injetável em teste). */
export interface ShortcutApi {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
  unregisterAll(): void
}

let current = OVERLAY_DEFAULT_SHORTCUT
let registered = false
let quitHookInstalled = false
let api: ShortcutApi = globalShortcut as unknown as ShortcutApi

/** Hook exclusivo de teste: troca a API global por um fake. */
export function setShortcutApiForTests(next: ShortcutApi | null): void {
  api = next ?? (globalShortcut as unknown as ShortcutApi)
}

function safeRegister(accelerator: string, onTrigger: () => void): boolean {
  try {
    return api.register(accelerator, onTrigger)
  } catch {
    return false
  }
}

function safeUnregister(accelerator: string): void {
  try {
    api.unregister(accelerator)
  } catch {
    // O SO pode já ter liberado o atalho (sessão encerrando).
  }
}

/** Desregistra uma única vez, no `will-quit`. */
function installQuitHook(): void {
  if (quitHookInstalled) return
  quitHookInstalled = true
  try {
    app.once('will-quit', unregisterOverlayShortcut)
  } catch {
    // Sem app pronto (teste isolado): o hook não é essencial para registrar.
  }
}

export function getShortcutStatus(): ShortcutStatus {
  return { registered, accelerator: current }
}

/**
 * Registra o atalho persistido.
 *
 * - atalho inválido não é registrado e não altera o valor atual;
 * - conflito (`register` devolve `false`) mantém o atalho anterior: o valor
 *   persistido não é sobrescrito e, se havia um atalho funcionando, ele é
 *   re-registrado para o usuário não ficar sem nenhum;
 * - o status devolve `{ registered, accelerator }` para a UI mostrar o conflito.
 */
export function registerOverlayShortcut(input: unknown, onTrigger: () => void): ShortcutStatus {
  installQuitHook()

  const normalized = normalizeAccelerator(input)
  if (!normalized) {
    logger.warn('shortcut', `atalho inválido ignorado: ${String(input)}`)
    return getShortcutStatus()
  }

  if (registered && current === normalized) return getShortcutStatus()

  const previous = current
  const hadPrevious = registered
  if (hadPrevious) safeUnregister(previous)

  if (safeRegister(normalized, onTrigger)) {
    current = normalized
    registered = true
    logger.info('shortcut', `atalho registrado: ${normalized}`)
    return getShortcutStatus()
  }

  logger.warn('shortcut', `conflito ao registrar o atalho: ${normalized}`)
  registered = false

  if (hadPrevious) {
    registered = safeRegister(previous, onTrigger)
    current = previous
    if (registered) logger.info('shortcut', `atalho anterior mantido: ${previous}`)
  } else {
    // Primeira tentativa em conflito: preserva o valor persistido (sem
    // fallback silencioso) e expõe registered=false no status.
    current = normalized
  }

  return getShortcutStatus()
}

/** Desregistra o atalho atual (will-quit/encerramento). */
export function unregisterOverlayShortcut(): void {
  if (registered) safeUnregister(current)
  registered = false
}

/** Hook exclusivo de teste. */
export function resetShortcutForTests(): void {
  current = OVERLAY_DEFAULT_SHORTCUT
  registered = false
  quitHookInstalled = false
  api = globalShortcut as unknown as ShortcutApi
}
