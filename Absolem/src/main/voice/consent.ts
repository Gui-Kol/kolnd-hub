import type { PermissionsConfig } from '../../shared/config'
import { VOICE_REASONS } from '../../shared/voice'

/**
 * Consentimento de microfone da task 06.
 *
 * Decisão do gerente: o consentimento mora em `permissions.microphone` (o
 * default do store já é `false`). Não existe `privacy.micConsent`. Negar
 * mantém o app funcional por texto e a voz vai para `error` com esta mensagem,
 * sem repetir o diálogo.
 */

export const MICROPHONE_DENIED_MESSAGE =
  'O microfone não foi autorizado. Você pode continuar usando o Absolem por texto ' +
  'e liberar o microfone nas configurações quando quiser.'

export const MICROPHONE_DENIED_REASON = VOICE_REASONS.consentDenied

export interface ConsentStoreLike {
  read: () => PermissionsConfig
  write: (next: PermissionsConfig) => { success: boolean; error?: string }
}

/** Aplica o consentimento preservando as demais permissões. */
export function withMicrophoneConsent(
  current: PermissionsConfig,
  granted: boolean
): PermissionsConfig {
  return { ...current, microphone: granted }
}

export function isMicrophoneGranted(store: ConsentStoreLike): boolean {
  try {
    return store.read().microphone === true
  } catch {
    return false
  }
}

/**
 * Persiste a decisão. Nunca lança: erro de disco vira `{ ok:false, error }` e
 * o chamador decide o estado da voz.
 */
export function setMicrophoneConsent(
  store: ConsentStoreLike,
  granted: boolean
): { ok: boolean; error?: string } {
  let current: PermissionsConfig
  try {
    current = store.read()
  } catch {
    return { ok: false, error: 'Não foi possível ler as permissões atuais.' }
  }
  const result = store.write(withMicrophoneConsent(current, granted))
  if (!result.success) {
    return { ok: false, error: result.error ?? 'Não foi possível salvar o consentimento.' }
  }
  return { ok: true }
}
