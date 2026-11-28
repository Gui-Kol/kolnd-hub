import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const state = vi.hoisted(() => ({
  dir: '',
  available: true,
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    // Simula um blob opaco: o texto cifrado é base64, nunca a chave em claro.
    encryptString: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
    decryptString: (blob: Buffer) => Buffer.from(blob.toString('utf8'), 'base64').toString('utf8')
  }
}))

vi.mock('./logger', () => ({
  logger: { info: state.logInfo, warn: state.logWarn, error: state.logError, debug: vi.fn() }
}))

import { clearApiKey, getApiKey, hasApiKey, setApiKey } from './secrets'

const FAKE_KEY = 'fake-key-123456'

beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), 'absolem-secrets-'))
  state.available = true
  state.logInfo.mockClear()
  state.logWarn.mockClear()
  state.logError.mockClear()
})

afterEach(() => {
  rmSync(state.dir, { recursive: true, force: true })
})

describe('secrets com safeStorage', () => {
  it('grava e lê de volta', () => {
    expect(setApiKey(FAKE_KEY)).toEqual({ ok: true })
    expect(hasApiKey()).toBe(true)
    expect(getApiKey()).toBe(FAKE_KEY)

    const file = join(state.dir, 'secrets.bin')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).not.toContain(FAKE_KEY)
  })

  it('sem encryption availability recusa gravar', () => {
    state.available = false

    const result = setApiKey(FAKE_KEY)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/safeStorage/)
    expect(existsSync(join(state.dir, 'secrets.bin'))).toBe(false)
    expect(hasApiKey()).toBe(false)
  })

  it('clearApiKey apaga', () => {
    expect(setApiKey(FAKE_KEY)).toEqual({ ok: true })
    expect(existsSync(join(state.dir, 'secrets.bin'))).toBe(true)

    expect(clearApiKey()).toEqual({ ok: true })

    expect(existsSync(join(state.dir, 'secrets.bin'))).toBe(false)
    expect(getApiKey()).toBeNull()
    expect(hasApiKey()).toBe(false)
  })
})
