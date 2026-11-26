import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { logger } from './logger'

/**
 * Chave de API da Gemini cifrada com `safeStorage` (DPAPI no Windows).
 *
 * - Mora em `userData/secrets.bin`, nunca no config.json, nunca em log e nunca
 *   atravessa o IPC (o renderer só saberá se existe chave; a escrita via IPC
 *   entra na task 05).
 * - Sem `safeStorage.isEncryptionAvailable()` a gravação é recusada: não existe
 *   fallback para texto plano.
 * - O blob é amarrado ao usuário do Windows. Trocar de conta ou restaurar o
 *   perfil em outra máquina exige redigitar a chave.
 */

const SECRETS_FILE = 'secrets.bin'
const MIN_KEY_LENGTH = 8
const MAX_KEY_LENGTH = 4096

export interface SecretResult {
  ok: boolean
  error?: string
}

function secretsPath(): string {
  return join(app.getPath('userData'), SECRETS_FILE)
}

function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable() === true
  } catch {
    return false
  }
}

/** `true` quando existe uma chave que pode ser decifrada nesta sessão. */
export function hasApiKey(): boolean {
  return getApiKey() !== null
}

/** Lê a chave em texto plano. Exportada só para uso interno do main. */
export function getApiKey(): string | null {
  if (!encryptionAvailable()) return null
  const path = secretsPath()
  if (!existsSync(path)) return null
  try {
    const decrypted = safeStorage.decryptString(readFileSync(path))
    const value = decrypted.trim()
    return value.length > 0 ? value : null
  } catch (err) {
    logger.warn(
      'secrets',
      'Não foi possível decifrar a chave salva; ela precisa ser redigitada:',
      err
    )
    return null
  }
}

/** Valida e grava a chave cifrada. Nunca registra o valor recebido. */
export function setApiKey(value: unknown): SecretResult {
  if (!encryptionAvailable()) {
    return {
      ok: false,
      error:
        'A proteção de credenciais do Windows (safeStorage/DPAPI) não está disponível. ' +
        'A chave não foi gravada.'
    }
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'Chave inválida: era esperado texto.' }
  }
  const key = value.trim()
  if (key.length < MIN_KEY_LENGTH) {
    return { ok: false, error: 'Chave inválida: curta demais.' }
  }
  if (key.length > MAX_KEY_LENGTH) {
    return { ok: false, error: 'Chave inválida: longa demais.' }
  }

  try {
    const encrypted = safeStorage.encryptString(key)
    writeFileSync(secretsPath(), encrypted, { mode: 0o600 })
    logger.info('secrets', 'Chave de API gravada com safeStorage (valor nunca vai para o log).')
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('secrets', 'Falha ao gravar a chave de API:', message)
    return { ok: false, error: `Não foi possível gravar a chave: ${message}` }
  }
}

/** Apaga o blob da chave. */
export function clearApiKey(): SecretResult {
  const path = secretsPath()
  try {
    if (existsSync(path)) unlinkSync(path)
    logger.info('secrets', 'Chave de API apagada.')
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('secrets', 'Falha ao apagar a chave de API:', message)
    return { ok: false, error: `Não foi possível apagar a chave: ${message}` }
  }
}
